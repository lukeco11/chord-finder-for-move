#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"

plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host);

typedef struct {
    uint8_t packets[512][4];
    int count;
} packet_log_t;

static packet_log_t move_log;
static packet_log_t external_log;
static packet_log_t schwung_log;
static int fail_move_sends;
static int fail_external_sends;

static int log_move(const uint8_t *msg, int len) {
    assert(len == 4);
    if (fail_move_sends > 0) {
        fail_move_sends--;
        return 0;
    }
    memcpy(move_log.packets[move_log.count++], msg, 4);
    return len;
}

static int log_external(const uint8_t *msg, int len) {
    assert(len == 4);
    if (fail_external_sends > 0) {
        fail_external_sends--;
        return 0;
    }
    memcpy(external_log.packets[external_log.count++], msg, 4);
    return len;
}

static int log_schwung(const uint8_t *msg, int len) {
    assert(len == 4);
    memcpy(schwung_log.packets[schwung_log.count++], msg, 4);
    return len;
}

static float host_bpm(void) { return 120.0f; }
static int host_clock(void) { return MOVE_CLOCK_STATUS_RUNNING; }

static void reset_logs(void) {
    memset(&move_log, 0, sizeof(move_log));
    memset(&external_log, 0, sizeof(external_log));
    memset(&schwung_log, 0, sizeof(schwung_log));
    fail_move_sends = 0;
    fail_external_sends = 0;
}

static void render(plugin_api_v2_t *api, void *instance, int blocks) {
    int16_t audio[MOVE_FRAMES_PER_BLOCK * 2];
    for (int i = 0; i < blocks; i++) {
        api->render_block(instance, audio, MOVE_FRAMES_PER_BLOCK);
    }
}

static unsigned state_uint(const char *state, const char *key) {
    char needle[48];
    const char *found;
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    found = strstr(state, needle);
    assert(found != NULL);
    return (unsigned)strtoul(found + strlen(needle), NULL, 10);
}

static void test_both_routes_and_voice_release(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":2,\"channel\":3,\"strum_ms\":0,\"gate\":85,\"rate\":2}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":2,\"velocity\":100,\"notes\":[60,64,67]}");
    render(api, instance, 1);
    assert(move_log.count == 3);
    assert(external_log.count == 3);
    assert(move_log.packets[0][1] == 0x93);

    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":2}");
    render(api, instance, 1);
    assert(move_log.count == 6);
    assert(external_log.count == 6);
    assert(move_log.packets[5][1] == 0x83);
}

static void test_routes_use_destination_usb_midi_cables(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":2,\"channel\":0,\"strum_ms\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":3,\"notes\":[60]}");
    render(api, instance, 1);

    assert(move_log.count == 1);
    assert(external_log.count == 1);
    assert(move_log.packets[0][0] == 0x29);
    assert(external_log.packets[0][0] == 0x29);

    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":3}");
    assert(move_log.packets[1][0] == 0x28);
    assert(external_log.packets[1][0] == 0x28);
}

static void test_schwung_preview_uses_internal_chain(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":16,\"route\":3,\"channel\":4,\"notes\":[60,64,67]}");
    render(api, instance, 1);

    assert(schwung_log.count == 3);
    assert(move_log.count == 0);
    assert(external_log.count == 0);
    assert(schwung_log.packets[0][0] == 0x09);
    assert(schwung_log.packets[0][1] == 0x94);

    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":16}");
    assert(schwung_log.count == 6);
    assert(schwung_log.packets[5][0] == 0x08);
}

static void test_schwung_progression_uses_internal_chain(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    for (int slot = 0; slot < 8; slot++) {
        char command[64];
        snprintf(command, sizeof(command), "{\"v\":1,\"op\":\"slot_clear\",\"slot\":%d}", slot);
        api->set_param(instance, "command", command);
    }
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":3,\"channel\":2,\"strum_ms\":0,\"gate\":50,\"rate\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"notes\":[60,64,67]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 1);

    assert(schwung_log.count == 3);
    assert(move_log.count == 0);
    assert(external_log.count == 0);
    assert(schwung_log.packets[0][0] == 0x09);
    assert(schwung_log.packets[0][1] == 0x92);

    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":0}");
    render(api, instance, 1);
    assert(schwung_log.count == 6);
    assert(schwung_log.packets[5][0] == 0x08);
}

static void test_known_broken_host_suppresses_native_output(plugin_api_v2_t *api, void *instance) {
    char before[256];
    char after[256];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"move_available\":0,\"strum_ms\":0}");
    assert(api->get_param(instance, "state", before, sizeof(before)) > 0);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":17,\"route\":0,\"notes\":[72]}");
    render(api, instance, 1);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":17}");
    assert(api->get_param(instance, "state", after, sizeof(after)) > 0);

    assert(move_log.count == 0);
    assert(state_uint(after, "dropped") == state_uint(before, "dropped"));
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"move_available\":1,\"strum_ms\":0}");
}

static void test_route_change_panics_old_destination(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0,\"gate\":85,\"rate\":2}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":1,\"velocity\":90,\"notes\":[60]}");
    render(api, instance, 1);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":1,\"channel\":0,\"strum_ms\":0,\"gate\":85,\"rate\":2}");
    render(api, instance, 1);
    assert(move_log.count == 2);
    assert(move_log.packets[1][1] == 0x80);
    assert(external_log.count == 0);
}

static void test_strum_is_scheduled_across_blocks(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":10,\"gate\":85,\"rate\":2}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":4,\"velocity\":100,\"notes\":[60,64,67]}");
    render(api, instance, 1);
    assert(move_log.count == 1);
    render(api, instance, 4);
    assert(move_log.count >= 2);
    render(api, instance, 4);
    assert(move_log.count == 3);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    render(api, instance, 1);
}

static void test_loop_slots_and_state(plugin_api_v2_t *api, void *instance) {
    char state[256];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0,\"gate\":50,\"rate\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"velocity\":100,\"notes\":[60,64,67]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":1,\"velocity\":90,\"notes\":[62,65,69]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 1);
    assert(move_log.count == 3);
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"running\":1") != NULL);
    assert(strstr(state, "\"step\":0") != NULL);
    render(api, instance, 50);
    assert(move_log.count > 3);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":0}");
    render(api, instance, 1);
}

static void test_loop_state_cycle_advances_when_step_is_unchanged(plugin_api_v2_t *api, void *instance) {
    char before[256];
    char after[256];
    unsigned first_cycle;
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    for (int slot = 0; slot < 8; slot++) {
        char command[64];
        snprintf(command, sizeof(command), "{\"v\":1,\"op\":\"slot_clear\",\"slot\":%d}", slot);
        api->set_param(instance, "command", command);
    }
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0,\"gate\":50,\"rate\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"notes\":[60]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 1);
    assert(api->get_param(instance, "state", before, sizeof(before)) > 0);
    assert(strstr(before, "\"step\":0") != NULL);
    first_cycle = state_uint(before, "cycle");

    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"notes\":[62]}");
    render(api, instance, 50);
    assert(api->get_param(instance, "state", after, sizeof(after)) > 0);
    assert(strstr(after, "\"step\":0") != NULL);
    assert(state_uint(after, "cycle") > first_cycle);
    assert(move_log.packets[move_log.count - 1][2] == 62);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":0}");
}

static void test_shared_notes_use_destination_refcounts(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":1,\"notes\":[60,64,67]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":2,\"notes\":[60,65,69]}");
    render(api, instance, 1);
    assert(move_log.count == 5);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":1}");
    assert(move_log.count == 7);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":2}");
    assert(move_log.count == 10);
}

static void test_replacement_cancels_pending_strum(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":50}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":8,\"notes\":[60,64,67]}");
    render(api, instance, 1);
    assert(move_log.count == 1);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":8,\"notes\":[62,65,69]}");
    render(api, instance, 40);
    assert(move_log.count == 5);
    for (int i = 0; i < move_log.count; i++) {
        assert(move_log.packets[i][2] != 64);
        assert(move_log.packets[i][2] != 67);
    }
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
}

static void test_failed_note_on_does_not_create_phantom_reference(plugin_api_v2_t *api, void *instance) {
    char state[256];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0}");
    fail_move_sends = 1;
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":9,\"notes\":[72]}");
    render(api, instance, 1);
    assert(move_log.count == 0);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":9}");
    assert(move_log.count == 0);
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"dropped\":") != NULL);
}

static void test_failed_note_off_is_retried(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":10,\"notes\":[60]}");
    render(api, instance, 1);
    assert(move_log.count == 1);

    fail_move_sends = 1;
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":10}");
    assert(move_log.count == 1);
    render(api, instance, 1);
    assert(move_log.count == 2);
    assert(move_log.packets[1][0] == 0x28);
    assert(move_log.packets[1][1] == 0x80);
    assert(move_log.packets[1][2] == 60);
}

static void test_loop_skips_trailing_empty_slots(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    for (int slot = 0; slot < 8; slot++) {
        char command[64];
        snprintf(command, sizeof(command), "{\"v\":1,\"op\":\"slot_clear\",\"slot\":%d}", slot);
        api->set_param(instance, "command", command);
    }
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0,\"gate\":50,\"rate\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"notes\":[60]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":1,\"notes\":[62]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 120);

    int note_ons[4] = {0};
    int note_on_count = 0;
    for (int i = 0; i < move_log.count && note_on_count < 4; i++) {
        if ((move_log.packets[i][1] & 0xf0) == 0x90 && move_log.packets[i][3] > 0)
            note_ons[note_on_count++] = move_log.packets[i][2];
    }
    assert(note_on_count >= 3);
    assert(note_ons[0] == 60);
    assert(note_ons[1] == 62);
    assert(note_ons[2] == 60);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":0}");
}

static void test_loop_clamps_strum_so_every_note_sounds_before_gate(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":100,\"gate\":50,\"rate\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_set\",\"slot\":0,\"notes\":[60,62,64,65,67,69]}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"slot_clear\",\"slot\":1}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 26);

    int note_on_count = 0;
    for (int i = 0; i < move_log.count; i++) {
        if ((move_log.packets[i][1] & 0xf0) == 0x90 && move_log.packets[i][3] > 0)
            note_on_count++;
    }
    assert(note_on_count == 6);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":0}");
}

static void test_sequence_ids_are_acknowledged_and_deduplicated(plugin_api_v2_t *api, void *instance) {
    char state[256];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"seq\":40,\"op\":\"voice_on\",\"owner\":11,\"notes\":[72]}");
    api->set_param(instance, "command", "{\"v\":1,\"seq\":40,\"op\":\"voice_on\",\"owner\":11,\"notes\":[74]}");
    render(api, instance, 1);
    assert(move_log.count == 1);
    assert(move_log.packets[0][2] == 72);
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"ack\":40") != NULL);
    api->set_param(instance, "command", "{\"v\":1,\"seq\":41,\"op\":\"voice_off\",\"owner\":11}");
}

static void test_lower_sequence_after_ui_reload_is_accepted(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"seq\":90,\"op\":\"voice_on\",\"owner\":13,\"notes\":[70]}");
    render(api, instance, 1);
    api->set_param(instance, "command", "{\"v\":1,\"seq\":1,\"op\":\"voice_on\",\"owner\":14,\"notes\":[71]}");
    render(api, instance, 1);
    assert(move_log.count == 2);
    assert(move_log.packets[1][2] == 71);
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
}

static void test_pending_cleanup_retries_destinations_independently(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":2,\"channel\":0,\"strum_ms\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":15,\"notes\":[77]}");
    render(api, instance, 1);
    fail_move_sends = 2;
    fail_external_sends = 1;
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_off\",\"owner\":15}");
    render(api, instance, 1);
    assert(move_log.count == 1);
    assert(external_log.count == 2);
    assert(external_log.packets[1][1] == 0x80);
    render(api, instance, 1);
    assert(move_log.count == 2);
}

static void test_output_test_plays_and_releases_a_triad(plugin_api_v2_t *api, void *instance) {
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"config\",\"route\":0,\"channel\":0,\"strum_ms\":0}");
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"output_test\",\"route\":0,\"channel\":0}");
    render(api, instance, 1);
    assert(move_log.count == 3);
    assert(move_log.packets[0][2] == 60);
    assert(move_log.packets[1][2] == 64);
    assert(move_log.packets[2][2] == 67);
    render(api, instance, 200);
    assert(move_log.count == 6);
}

static void test_panic_retries_rejected_cleanup(plugin_api_v2_t *api, void *instance) {
    char state[256];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"voice_on\",\"owner\":12,\"notes\":[76]}");
    render(api, instance, 1);
    fail_move_sends = 1;
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"pendingOffs\":1") != NULL);
    render(api, instance, 1);
    assert(move_log.count == 2);
    assert(move_log.packets[1][2] == 76);
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"pendingOffs\":0") != NULL);
}

static void test_empty_progression_does_not_start_transport(plugin_api_v2_t *api, void *instance) {
    char state[256];
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    for (int slot = 0; slot < 8; slot++) {
        char command[64];
        snprintf(command, sizeof(command), "{\"v\":1,\"op\":\"slot_clear\",\"slot\":%d}", slot);
        api->set_param(instance, "command", command);
    }
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"transport\",\"running\":1}");
    render(api, instance, 1);
    assert(api->get_param(instance, "state", state, sizeof(state)) > 0);
    assert(strstr(state, "\"running\":0") != NULL);
    assert(strstr(state, "\"length\":0") != NULL);
}

static void test_destroy_retries_every_deferred_note_off(plugin_api_v2_t *api, void *instance) {
    char command[192];
    reset_logs();
    api->set_param(instance, "command", "{\"v\":1,\"op\":\"panic\"}");
    for (int owner = 0; owner < 22; owner++) {
        int channel = owner % 16;
        int group = owner / 16;
        int base = 24 + group * 12;
        snprintf(command, sizeof(command),
                 "{\"v\":1,\"op\":\"voice_on\",\"owner\":%d,\"route\":0,\"channel\":%d,\"notes\":[%d,%d,%d,%d,%d,%d]}",
                 owner, channel, base, base + 1, base + 2, base + 3, base + 4, base + 5);
        api->set_param(instance, "command", command);
        render(api, instance, 1);
    }
    assert(move_log.count == 132);
    fail_move_sends = 132;
    api->destroy_instance(instance);
    assert(move_log.count == 264);
}

int main(void) {
    host_api_v1_t host = {
        .api_version = 1,
        .sample_rate = MOVE_SAMPLE_RATE,
        .frames_per_block = MOVE_FRAMES_PER_BLOCK,
        .midi_send_internal = log_schwung,
        .midi_send_external = log_external,
        .get_clock_status = host_clock,
        .get_bpm = host_bpm,
        .midi_inject_to_move = log_move,
    };
    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    assert(api != NULL);
    void *instance = api->create_instance(".", NULL);
    assert(instance != NULL);

    test_both_routes_and_voice_release(api, instance);
    test_routes_use_destination_usb_midi_cables(api, instance);
    test_schwung_preview_uses_internal_chain(api, instance);
    test_schwung_progression_uses_internal_chain(api, instance);
    test_known_broken_host_suppresses_native_output(api, instance);
    test_route_change_panics_old_destination(api, instance);
    test_strum_is_scheduled_across_blocks(api, instance);
    test_loop_slots_and_state(api, instance);
    test_loop_state_cycle_advances_when_step_is_unchanged(api, instance);
    test_shared_notes_use_destination_refcounts(api, instance);
    test_replacement_cancels_pending_strum(api, instance);
    test_failed_note_on_does_not_create_phantom_reference(api, instance);
    test_failed_note_off_is_retried(api, instance);
    test_loop_skips_trailing_empty_slots(api, instance);
    test_loop_clamps_strum_so_every_note_sounds_before_gate(api, instance);
    test_sequence_ids_are_acknowledged_and_deduplicated(api, instance);
    test_lower_sequence_after_ui_reload_is_accepted(api, instance);
    test_pending_cleanup_retries_destinations_independently(api, instance);
    test_output_test_plays_and_releases_a_triad(api, instance);
    test_panic_retries_rejected_cleanup(api, instance);
    test_empty_progression_does_not_start_transport(api, instance);
    test_destroy_retries_every_deferred_note_off(api, instance);
    puts("DSP tests passed");
    return 0;
}
