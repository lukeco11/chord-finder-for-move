#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"

#define MAX_OWNERS 64
#define MAX_NOTES 6
#define SLOT_COUNT 8
#define MAX_EVENTS 128
#define DEFAULT_BPM 120.0f
#define LOOP_OWNER 63
#define TEST_OWNER 62
#define USB_A_CABLE 2

enum {
    DESTINATION_MOVE = 0,
    DESTINATION_EXTERNAL = 1,
    DESTINATION_SCHWUNG = 2,
    DESTINATION_COUNT = 3
};
enum { ROUTE_MOVE = 0, ROUTE_EXTERNAL = 1, ROUTE_BOTH = 2, ROUTE_SCHWUNG = 3 };
enum { EVENT_NOTE_ON = 1, EVENT_OWNER_OFF = 2 };

typedef struct {
    uint8_t active;
    uint8_t route;
    uint8_t channel;
    uint8_t velocity;
    uint8_t count;
    uint8_t notes[MAX_NOTES];
    uint8_t sounding[MAX_NOTES];
} voice_t;

typedef struct {
    uint8_t count;
    uint8_t velocity;
    uint8_t notes[MAX_NOTES];
} slot_t;

typedef struct {
    uint8_t active;
    uint8_t kind;
    uint8_t owner;
    uint8_t note_index;
    int32_t due;
} event_t;

typedef struct {
    const host_api_v1_t *host;
    uint32_t sample_rate;
    uint8_t route;
    uint8_t channel;
    uint8_t gate;
    uint8_t rate;
    uint8_t move_available;
    uint16_t strum_ms;
    uint8_t armed;
    uint8_t running;
    uint8_t beat_sync_valid;
    uint8_t loop_cursor;
    uint8_t loop_length;
    int8_t displayed_step;
    int32_t samples_to_next;
    uint64_t last_grid_step;
    double last_beat_position;
    uint32_t loop_cycle;
    uint32_t dropped;
    uint32_t last_seq;
    uint8_t has_last_seq;
    voice_t voices[MAX_OWNERS];
    slot_t slots[SLOT_COUNT];
    event_t events[MAX_EVENTS];
    uint16_t refs[DESTINATION_COUNT][16][128];
    uint8_t pending_off[DESTINATION_COUNT][16][128];
} chord_finder_t;

static const host_api_v1_t *g_host;

static int route_has_move(int route) { return route == ROUTE_MOVE || route == ROUTE_BOTH; }
static int route_has_external(int route) { return route == ROUTE_EXTERNAL || route == ROUTE_BOTH; }
static int route_has_schwung(int route) { return route == ROUTE_SCHWUNG; }

static const char *json_value(const char *json, const char *key) {
    char needle[48];
    const char *found;
    if (!json || !key) return NULL;
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    found = strstr(json, needle);
    if (!found) return NULL;
    found = strchr(found + strlen(needle), ':');
    if (!found) return NULL;
    found++;
    while (*found == ' ' || *found == '\t') found++;
    return found;
}

static int json_int(const char *json, const char *key, int fallback) {
    const char *value = json_value(json, key);
    return value ? (int)strtol(value, NULL, 10) : fallback;
}

static int json_string(const char *json, const char *key, char *out, size_t out_len) {
    const char *value = json_value(json, key);
    size_t length = 0;
    if (!value || *value != '\"' || out_len == 0) return 0;
    value++;
    while (value[length] && value[length] != '\"' && length + 1 < out_len) length++;
    if (value[length] != '\"') return 0;
    memcpy(out, value, length);
    out[length] = '\0';
    return 1;
}

static int json_notes(const char *json, uint8_t notes[MAX_NOTES]) {
    const char *value = json_value(json, "notes");
    int count = 0;
    if (!value || *value != '[') return 0;
    value++;
    while (*value && *value != ']' && count < MAX_NOTES) {
        char *end;
        long note;
        while (*value == ' ' || *value == ',' || *value == '\t') value++;
        note = strtol(value, &end, 10);
        if (end == value) break;
        if (note >= 0 && note <= 127) notes[count++] = (uint8_t)note;
        value = end;
    }
    return count;
}

static int send_packet(chord_finder_t *s, int destination, uint8_t cin,
                       uint8_t status, uint8_t note, uint8_t velocity) {
    uint8_t cable = destination == DESTINATION_SCHWUNG ? 0 : USB_A_CABLE;
    uint8_t packet[4] = {
        (uint8_t)((cable << 4) | (cin & 0x0f)), status, note, velocity
    };
    int sent = 0;
    if (destination == DESTINATION_MOVE && !s->move_available) return 1;
    if (destination == DESTINATION_MOVE && s->host && s->host->midi_inject_to_move)
        sent = s->host->midi_inject_to_move(packet, 4);
    if (destination == DESTINATION_EXTERNAL && s->host && s->host->midi_send_external)
        sent = s->host->midi_send_external(packet, 4);
    if (destination == DESTINATION_SCHWUNG && s->host && s->host->midi_send_internal)
        sent = s->host->midi_send_internal(packet, 4);
    if (sent != 4) s->dropped++;
    return sent == 4;
}

static void destination_note_on(chord_finder_t *s, int destination, int channel,
                                int note, int velocity) {
    uint16_t *refs = &s->refs[destination][channel][note];
    uint8_t *pending = &s->pending_off[destination][channel][note];
    if (*pending) {
        if (!send_packet(s, destination, 0x08, (uint8_t)(0x80 | channel),
                         (uint8_t)note, 0))
            return;
        *pending = 0;
        *refs = 0;
    }
    if (*refs > 0) {
        (*refs)++;
        return;
    }
    if (send_packet(s, destination, 0x09, (uint8_t)(0x90 | channel),
                    (uint8_t)note, (uint8_t)velocity))
        *refs = 1;
}

static void destination_note_off(chord_finder_t *s, int destination, int channel, int note) {
    uint16_t *refs = &s->refs[destination][channel][note];
    uint8_t *pending = &s->pending_off[destination][channel][note];
    if (*refs == 0) return;
    if (*refs > 1) {
        (*refs)--;
        return;
    }
    if (send_packet(s, destination, 0x08, (uint8_t)(0x80 | channel),
                    (uint8_t)note, 0)) {
        *refs = 0;
        *pending = 0;
    } else {
        *pending = 1;
    }
}

static void retry_pending_offs(chord_finder_t *s, int maximum_per_destination) {
    int destination, channel, note;
    for (destination = 0; destination < DESTINATION_COUNT; destination++) {
        int sent = 0;
        for (channel = 0; channel < 16 && sent < maximum_per_destination; channel++) {
            for (note = 0; note < 128 && sent < maximum_per_destination; note++) {
                if (!s->pending_off[destination][channel][note]) continue;
                if (!send_packet(s, destination, 0x08, (uint8_t)(0x80 | channel),
                                 (uint8_t)note, 0))
                    goto next_destination;
                s->pending_off[destination][channel][note] = 0;
                s->refs[destination][channel][note] = 0;
                sent++;
            }
        }
next_destination:
        ;
    }
}

static void emit_note_on(chord_finder_t *s, const voice_t *voice, int note) {
    if (route_has_move(voice->route))
        destination_note_on(s, DESTINATION_MOVE, voice->channel, note, voice->velocity);
    if (route_has_external(voice->route))
        destination_note_on(s, DESTINATION_EXTERNAL, voice->channel, note, voice->velocity);
    if (route_has_schwung(voice->route))
        destination_note_on(s, DESTINATION_SCHWUNG, voice->channel, note, voice->velocity);
}

static void emit_note_off(chord_finder_t *s, const voice_t *voice, int note) {
    if (route_has_move(voice->route))
        destination_note_off(s, DESTINATION_MOVE, voice->channel, note);
    if (route_has_external(voice->route))
        destination_note_off(s, DESTINATION_EXTERNAL, voice->channel, note);
    if (route_has_schwung(voice->route))
        destination_note_off(s, DESTINATION_SCHWUNG, voice->channel, note);
}

static void cancel_owner_events(chord_finder_t *s, int owner) {
    int index;
    for (index = 0; index < MAX_EVENTS; index++)
        if (s->events[index].active && s->events[index].owner == owner)
            s->events[index].active = 0;
}

static void release_voice(chord_finder_t *s, int owner) {
    int index;
    voice_t *voice;
    if (owner < 0 || owner >= MAX_OWNERS) return;
    voice = &s->voices[owner];
    cancel_owner_events(s, owner);
    if (!voice->active) return;
    for (index = 0; index < voice->count; index++) {
        if (voice->sounding[index]) emit_note_off(s, voice, voice->notes[index]);
    }
    memset(voice, 0, sizeof(*voice));
}

static int schedule_event(chord_finder_t *s, int kind, int owner, int note_index, int32_t due) {
    int index;
    for (index = 0; index < MAX_EVENTS; index++) {
        if (!s->events[index].active) {
            s->events[index].active = 1;
            s->events[index].kind = (uint8_t)kind;
            s->events[index].owner = (uint8_t)owner;
            s->events[index].note_index = (uint8_t)note_index;
            s->events[index].due = due;
            return 1;
        }
    }
    s->dropped++;
    return 0;
}

static void start_voice(chord_finder_t *s, int owner, const uint8_t *notes, int count,
                        int velocity, int route, int channel, int gate_samples) {
    int index;
    voice_t *voice;
    int32_t strum_samples;
    if (owner < 0 || owner >= MAX_OWNERS || count <= 0) return;
    release_voice(s, owner);
    voice = &s->voices[owner];
    voice->active = 1;
    voice->route = (uint8_t)route;
    voice->channel = (uint8_t)channel;
    voice->velocity = (uint8_t)velocity;
    voice->count = (uint8_t)(count > MAX_NOTES ? MAX_NOTES : count);
    strum_samples = (int32_t)(((uint64_t)s->sample_rate * s->strum_ms) / 1000U);
    if (gate_samples > 0 && voice->count > 1) {
        int32_t maximum_spacing = (gate_samples - 1) / (voice->count - 1);
        if (strum_samples > maximum_spacing) strum_samples = maximum_spacing;
    }
    for (index = 0; index < voice->count; index++) {
        voice->notes[index] = notes[index];
        schedule_event(s, EVENT_NOTE_ON, owner, index, strum_samples * index);
    }
    if (gate_samples > 0) schedule_event(s, EVENT_OWNER_OFF, owner, 0, gate_samples);
}

static void panic(chord_finder_t *s) {
    int owner, event, destination, channel, note;
    for (owner = 0; owner < MAX_OWNERS; owner++) release_voice(s, owner);
    for (event = 0; event < MAX_EVENTS; event++) s->events[event].active = 0;
    for (destination = 0; destination < DESTINATION_COUNT; destination++) {
        for (channel = 0; channel < 16; channel++) {
            for (note = 0; note < 128; note++) {
                if (s->refs[destination][channel][note] > 0) {
                    s->pending_off[destination][channel][note] = 1;
                }
            }
        }
    }
}

static void recompute_loop_length(chord_finder_t *s) {
    int index;
    s->loop_length = 0;
    for (index = 0; index < SLOT_COUNT; index++) {
        if (s->slots[index].count > 0) s->loop_length = (uint8_t)(index + 1);
    }
    if (s->loop_length > 0 && s->loop_cursor >= s->loop_length) s->loop_cursor = 0;
}

static void process_events(chord_finder_t *s, int frames) {
    int index;
    for (index = 0; index < MAX_EVENTS; index++) {
        event_t event;
        voice_t *voice;
        if (!s->events[index].active) continue;
        if (s->events[index].due > 0) {
            s->events[index].due -= frames;
            continue;
        }
        event = s->events[index];
        s->events[index].active = 0;
        if (event.owner >= MAX_OWNERS) continue;
        voice = &s->voices[event.owner];
        if (event.kind == EVENT_OWNER_OFF) {
            release_voice(s, event.owner);
        } else if (event.kind == EVENT_NOTE_ON && voice->active && event.note_index < voice->count) {
            emit_note_on(s, voice, voice->notes[event.note_index]);
            voice->sounding[event.note_index] = 1;
        }
    }
}

static float current_bpm(chord_finder_t *s) {
    float bpm = DEFAULT_BPM;
    if (s->host && s->host->get_bpm) bpm = s->host->get_bpm();
    if (bpm < 20.0f || bpm > 400.0f) bpm = DEFAULT_BPM;
    return bpm;
}

static int loop_step_samples(chord_finder_t *s) {
    static const float beats[5] = { 0.25f, 0.5f, 1.0f, 2.0f, 4.0f };
    float seconds = (60.0f / current_bpm(s)) * beats[s->rate > 4 ? 4 : s->rate];
    int samples = (int)(seconds * (float)s->sample_rate + 0.5f);
    return samples < MOVE_FRAMES_PER_BLOCK ? MOVE_FRAMES_PER_BLOCK : samples;
}

static double loop_step_beats(chord_finder_t *s) {
    static const double beats[5] = { 0.25, 0.5, 1.0, 2.0, 4.0 };
    return beats[s->rate > 4 ? 4 : s->rate];
}

static void fire_loop_index(chord_finder_t *s, uint64_t grid_step) {
    int step_samples = loop_step_samples(s);
    uint8_t slot_index;
    slot_t *slot;
    s->loop_cycle++;
    if (s->loop_length == 0) {
        s->displayed_step = -1;
        return;
    }
    slot_index = (uint8_t)(grid_step % s->loop_length);
    slot = &s->slots[slot_index];
    release_voice(s, LOOP_OWNER);
    s->displayed_step = (int8_t)slot_index;
    if (slot->count > 0) {
        int gate_samples = step_samples * s->gate / 100;
        start_voice(s, LOOP_OWNER, slot->notes, slot->count, slot->velocity,
                    s->route, s->channel, gate_samples);
    }
}

static void fire_free_loop_step(chord_finder_t *s) {
    if (s->loop_length == 0) {
        s->displayed_step = -1;
        s->samples_to_next += loop_step_samples(s);
        return;
    }
    fire_loop_index(s, s->loop_cursor);
    s->loop_cursor = (uint8_t)((s->loop_cursor + 1) % s->loop_length);
    s->samples_to_next += loop_step_samples(s);
}

static void stop_synced_playback(chord_finder_t *s) {
    release_voice(s, LOOP_OWNER);
    s->running = 0;
    s->beat_sync_valid = 0;
    s->displayed_step = -1;
}

static void sync_to_move_transport(chord_finder_t *s, int frames) {
    double beat;
    double step_beats;
    double offset;
    double boundary_tolerance;
    uint64_t grid_step;

    if (!s->armed || s->loop_length == 0) {
        stop_synced_playback(s);
        return;
    }
    beat = s->host->get_beat_position();
    if (beat < 0.0) {
        stop_synced_playback(s);
        return;
    }

    step_beats = loop_step_beats(s);
    grid_step = (uint64_t)(beat / step_beats);
    offset = beat - ((double)grid_step * step_beats);
    boundary_tolerance = ((double)frames / (double)s->sample_rate)
        * ((double)current_bpm(s) / 60.0) * 1.5;
    s->running = 1;

    if (!s->beat_sync_valid) {
        s->beat_sync_valid = 1;
        s->last_grid_step = grid_step;
        s->last_beat_position = beat;
        if (offset <= boundary_tolerance) fire_loop_index(s, grid_step);
        return;
    }

    if (beat < s->last_beat_position) {
        release_voice(s, LOOP_OWNER);
        s->displayed_step = -1;
        if (offset <= boundary_tolerance) fire_loop_index(s, grid_step);
    } else if (grid_step != s->last_grid_step) {
        fire_loop_index(s, grid_step);
    }
    s->last_grid_step = grid_step;
    s->last_beat_position = beat;
}

static void *create_instance(const char *module_dir, const char *json_defaults) {
    chord_finder_t *s = (chord_finder_t *)calloc(1, sizeof(*s));
    (void)module_dir;
    (void)json_defaults;
    if (!s) return NULL;
    s->host = g_host;
    s->sample_rate = (g_host && g_host->sample_rate > 0) ? (uint32_t)g_host->sample_rate : MOVE_SAMPLE_RATE;
    s->route = ROUTE_MOVE;
    s->gate = 85;
    s->rate = 2;
    s->move_available = 1;
    s->displayed_step = -1;
    return s;
}

static void destroy_instance(void *instance) {
    chord_finder_t *s = (chord_finder_t *)instance;
    if (!s) return;
    panic(s);
    retry_pending_offs(s, 4096);
    free(s);
}

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)instance;
    (void)msg;
    (void)len;
    (void)source;
}

static void set_command(chord_finder_t *s, const char *json) {
    char op[24];
    int seq;
    if (!json || json_int(json, "v", -1) != 1 || !json_string(json, "op", op, sizeof(op))) return;
    seq = json_int(json, "seq", -1);
    if (seq >= 0 && s->has_last_seq && (uint32_t)seq == s->last_seq) return;

    if (strcmp(op, "config") == 0) {
        int route = json_int(json, "route", s->route);
        int channel = json_int(json, "channel", s->channel);
        int move_available = json_int(json, "move_available", s->move_available) ? 1 : 0;
        if (route < ROUTE_MOVE || route > ROUTE_SCHWUNG) route = ROUTE_MOVE;
        if (channel < 0) channel = 0;
        if (channel > 15) channel = 15;
        if (route != s->route || channel != s->channel || move_available != s->move_available)
            panic(s);
        s->route = (uint8_t)route;
        s->channel = (uint8_t)channel;
        s->move_available = (uint8_t)move_available;
        s->strum_ms = (uint16_t)json_int(json, "strum_ms", s->strum_ms);
        if (s->strum_ms > 100) s->strum_ms = 100;
        s->gate = (uint8_t)json_int(json, "gate", s->gate);
        if (s->gate < 10) s->gate = 10;
        if (s->gate > 100) s->gate = 100;
        {
            uint8_t old_rate = s->rate;
            s->rate = (uint8_t)json_int(json, "rate", s->rate);
            if (s->rate > 4) s->rate = 4;
            if (s->rate != old_rate && s->host && s->host->get_beat_position)
                stop_synced_playback(s);
        }
    } else if (strcmp(op, "voice_on") == 0) {
        uint8_t notes[MAX_NOTES];
        int owner = json_int(json, "owner", -1);
        int count = json_notes(json, notes);
        int velocity = json_int(json, "velocity", 100);
        int route = json_int(json, "route", s->route);
        int channel = json_int(json, "channel", s->channel);
        if (velocity < 1) velocity = 1;
        if (velocity > 127) velocity = 127;
        if (route < ROUTE_MOVE || route > ROUTE_SCHWUNG) route = s->route;
        if (channel < 0 || channel > 15) channel = s->channel;
        start_voice(s, owner, notes, count, velocity, route, channel, 0);
    } else if (strcmp(op, "voice_off") == 0) {
        release_voice(s, json_int(json, "owner", -1));
    } else if (strcmp(op, "slot_set") == 0) {
        int slot_index = json_int(json, "slot", -1);
        if (slot_index >= 0 && slot_index < SLOT_COUNT) {
            slot_t *slot = &s->slots[slot_index];
            slot->count = (uint8_t)json_notes(json, slot->notes);
            slot->velocity = (uint8_t)json_int(json, "velocity", 100);
            if (slot->velocity < 1 || slot->velocity > 127) slot->velocity = 100;
            recompute_loop_length(s);
        }
    } else if (strcmp(op, "slot_clear") == 0) {
        int slot_index = json_int(json, "slot", -1);
        if (slot_index >= 0 && slot_index < SLOT_COUNT) {
            memset(&s->slots[slot_index], 0, sizeof(slot_t));
            recompute_loop_length(s);
        }
    } else if (strcmp(op, "transport") == 0) {
        int running = json_int(json, "running", 0) ? 1 : 0;
        if (running && s->loop_length > 0 && !s->armed) {
            s->armed = 1;
            s->beat_sync_valid = 0;
            s->loop_cursor = 0;
            s->displayed_step = -1;
            s->samples_to_next = 0;
            if (!s->host || !s->host->get_beat_position) s->running = 1;
        } else if (!running && s->armed) {
            s->armed = 0;
            s->running = 0;
            s->beat_sync_valid = 0;
            s->loop_cursor = 0;
            s->displayed_step = -1;
            s->samples_to_next = 0;
            panic(s);
        }
    } else if (strcmp(op, "panic") == 0) {
        panic(s);
    } else if (strcmp(op, "output_test") == 0) {
        static const uint8_t notes[3] = { 60, 64, 67 };
        int route = json_int(json, "route", s->route);
        int channel = json_int(json, "channel", s->channel);
        if (route < ROUTE_MOVE || route > ROUTE_SCHWUNG) route = s->route;
        if (channel < 0 || channel > 15) channel = s->channel;
        start_voice(s, TEST_OWNER, notes, 3, 100, route, channel,
                    (int)(s->sample_rate / 2U));
    }
    if (seq >= 0) {
        s->last_seq = (uint32_t)seq;
        s->has_last_seq = 1;
    }
}

static void set_param(void *instance, const char *key, const char *value) {
    chord_finder_t *s = (chord_finder_t *)instance;
    if (s && key && strcmp(key, "command") == 0) set_command(s, value);
}

static int active_owner_count(const chord_finder_t *s) {
    int owner, count = 0;
    for (owner = 0; owner < MAX_OWNERS; owner++) if (s->voices[owner].active) count++;
    return count;
}

static int pending_off_count(const chord_finder_t *s) {
    int destination, channel, note, count = 0;
    for (destination = 0; destination < DESTINATION_COUNT; destination++)
        for (channel = 0; channel < 16; channel++)
            for (note = 0; note < 128; note++)
                if (s->pending_off[destination][channel][note]) count++;
    return count;
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    chord_finder_t *s = (chord_finder_t *)instance;
    if (!s || !key || !buf || buf_len <= 0 || strcmp(key, "state") != 0) return -1;
    return snprintf(buf, (size_t)buf_len,
                    "{\"v\":1,\"armed\":%d,\"running\":%d,\"step\":%d,\"cycle\":%u,\"length\":%d,\"route\":%d,\"channel\":%d,\"moveAvailable\":%d,\"activeOwners\":%d,\"pendingOffs\":%d,\"dropped\":%u,\"ack\":%u}",
                    s->armed, s->running, s->displayed_step, s->loop_cycle, s->loop_length, s->route,
                    s->channel, s->move_available, active_owner_count(s), pending_off_count(s),
                    s->dropped, s->last_seq);
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *audio, int frames) {
    chord_finder_t *s = (chord_finder_t *)instance;
    if (audio && frames > 0) memset(audio, 0, (size_t)frames * 2U * sizeof(int16_t));
    if (!s) return;
    retry_pending_offs(s, 8);
    if (s->host && s->host->get_beat_position) {
        sync_to_move_transport(s, frames);
    } else if (s->running && s->samples_to_next <= 0) {
        fire_free_loop_step(s);
    }
    process_events(s, frames);
    if (!s->running || (s->host && s->host->get_beat_position)) return;
    s->samples_to_next -= frames;
}

static plugin_api_v2_t g_api = {
    .api_version = MOVE_PLUGIN_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .on_midi = on_midi,
    .set_param = set_param,
    .get_param = get_param,
    .get_error = get_error,
    .render_block = render_block,
};

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &g_api;
}
