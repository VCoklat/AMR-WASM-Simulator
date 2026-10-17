#include <vector>
#include <cmath>
#include <algorithm>
#include <emscripten/emscripten.h>

#define GRID_WIDTH 20
#define GRID_HEIGHT 20

extern int grid[GRID_WIDTH][GRID_HEIGHT];

extern "C" {
    int calculate_path(int start_x, int start_y, int goal_x, int goal_y);
    int get_path_x(int index);
    int get_path_y(int index);
}

enum class RobotState {
    IDLE = 0,
    MOVING = 1,
    CHARGING = 2,
    HALTED = 3   // Safety stop: shared human-AMR zone is full (Scenario A / PS-5)
};

// ---------------- Scenario A: shared aisle zone ----------------
// Cells occupied by objects/people detected by the edge camera.
// They act as dynamic obstacles for A* and count toward zone capacity.
int occupied[GRID_WIDTH][GRID_HEIGHT] = {0};
int zone_x0 = 11, zone_y0 = 6, zone_x1 = 12, zone_y1 = 13; // inclusive
int zone_capacity = 2;
int total_replans = 0;
int total_trips = 0;
float total_detour_cells = 0.0f; // extra cells versus the original (static) route

static bool in_zone(int x, int y) {
    return x >= zone_x0 && x <= zone_x1 && y >= zone_y0 && y <= zone_y1;
}

static int zone_occupied_count() {
    int n = 0;
    for (int x = zone_x0; x <= zone_x1; x++)
        for (int y = zone_y0; y <= zone_y1; y++)
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT && occupied[x][y]) n++;
    return n;
}

static bool zone_full() {
    return zone_capacity > 0 && zone_occupied_count() >= zone_capacity;
}

struct Waypoint {
    float x;
    float y;
};

struct Dock {
    float x;
    float y;
};

// Distributed charging stations across the warehouse floor
const std::vector<Dock> CHARGING_DOCKS = {
    {0.0f, 0.0f},   // Dock 0 (Top-Left)
    {0.0f, 19.0f},  // Dock 1 (Bottom-Left)
    {19.0f, 0.0f}   // Dock 2 (Top-Right)
};

struct Robot {
    int id;
    float x;
    float y;
    float battery;
    float speed;
    RobotState state;
    std::vector<Waypoint> path;
    size_t path_index;
    int assigned_dock_idx;
    float distance_travelled;
    int replans;
    int trips;
    bool waiting_for_route; // goal currently unreachable; retry each frame

    Robot(int id, float start_x, float start_y, int dock_idx) 
        : id(id), x(start_x), y(start_y), battery(100.0f), speed(5.0f), state(RobotState::IDLE), path_index(0), assigned_dock_idx(dock_idx),
          distance_travelled(0.0f), replans(0), trips(0), waiting_for_route(false) {}

    bool loadPath(int sx, int sy, int gx, int gy) {
        int len = calculate_path(sx, sy, gx, gy);
        if (len <= 0) return false;
        path.clear();
        for (int i = 0; i < len; i++) path.push_back({(float)get_path_x(i), (float)get_path_y(i)});
        path_index = 0;
        return true;
    }

    // Re-plan when a newly detected object blocks the remaining route.
    void checkBlockedRoute() {
        if (path.empty() || path_index >= path.size()) return;
        bool blocked = false;
        for (size_t i = path_index; i < path.size(); i++) {
            int px = (int)path[i].x, py = (int)path[i].y;
            if (grid[px][py] == 1) { blocked = true; break; }
        }
        if (!blocked && !waiting_for_route) return;
        int old_remaining = (int)(path.size() - path_index);
        Waypoint goal = path.back();
        int sx = (int)std::round(x), sy = (int)std::round(y);
        if (loadPath(sx, sy, (int)goal.x, (int)goal.y)) {
            if (blocked) {
                int extra = (int)path.size() - old_remaining;
                if (extra > 0) total_detour_cells += extra;
                replans++;
                total_replans++;
            }
            waiting_for_route = false;
        } else {
            // No route right now: keep the goal, wait in place until a cell frees up.
            path.erase(path.begin() + path_index, path.end() - 1);
            path_index = path.size() - 1;
            waiting_for_route = true;
        }
    }

    bool isAtDock() {
        int gx = static_cast<int>(std::round(x));
        int gy = static_cast<int>(std::round(y));
        for (const auto& dock : CHARGING_DOCKS) {
            if (gx == static_cast<int>(dock.x) && gy == static_cast<int>(dock.y)) return true;
        }
        return false;
    }

    void update(float dt) {
        if (state == RobotState::CHARGING) {
            battery += 35.0f * dt;
            if (battery >= 100.0f) {
                battery = 100.0f;
                state = RobotState::IDLE;
            }
            return;
        }

        if (state == RobotState::MOVING) {
            battery -= 4.0f * dt;
            if (battery < 0.0f) battery = 0.0f;
        }

        int start_gx = static_cast<int>(std::round(x));
        int start_gy = static_cast<int>(std::round(y));

        // Dynamic Nearest-Dock Evaluation & Fail-Safe
        bool heading_to_dock = !path.empty() && [&]() {
            int last_x = static_cast<int>(path.back().x);
            int last_y = static_cast<int>(path.back().y);
            for (const auto& d : CHARGING_DOCKS) {
                if (last_x == static_cast<int>(d.x) && last_y == static_cast<int>(d.y)) return true;
            }
            return false;
        }();

        if (state != RobotState::CHARGING && !heading_to_dock) {
            int best_dock_x = 0, best_dock_y = 0;
            int shortest_path_len = 99999;

            for (const auto& dock : CHARGING_DOCKS) {
                int p_len = calculate_path(start_gx, start_gy, static_cast<int>(dock.x), static_cast<int>(dock.y));
                if (p_len > 0 && p_len < shortest_path_len) {
                    shortest_path_len = p_len;
                    best_dock_x = static_cast<int>(dock.x);
                    best_dock_y = static_cast<int>(dock.y);
                }
            }

            float energy_per_unit = 4.0f / speed;
            float estimated_energy_needed = static_cast<float>(shortest_path_len) * energy_per_unit;
            float safety_margin_buffer = 10.0f;

            if (battery <= (estimated_energy_needed + safety_margin_buffer)) {
                if (shortest_path_len > 0 && !isAtDock()) {
                    int path_len = calculate_path(start_gx, start_gy, best_dock_x, best_dock_y);
                    if (path_len > 0) {
                        path.clear();
                        for (int i = 0; i < path_len; i++) {
                            path.push_back({(float)get_path_x(i), (float)get_path_y(i)});
                        }
                        path_index = 0;
                        state = RobotState::MOVING;
                    }
                }
            }
        }

        if (isAtDock() && battery < 85.0f && state != RobotState::CHARGING) {
            path.clear();
            state = RobotState::CHARGING;
            return;
        }

        // Safety stop: zone full -> robots inside or about to enter the zone halt.
        if (state == RobotState::MOVING || state == RobotState::HALTED) {
            bool full = zone_full();
            int cx = (int)std::round(x), cy = (int)std::round(y);
            bool entering = path_index < path.size() && in_zone((int)path[path_index].x, (int)path[path_index].y);
            if (full && (in_zone(cx, cy) || entering)) {
                state = RobotState::HALTED;
                return;
            }
            if (state == RobotState::HALTED) state = RobotState::MOVING;
        }

        if (state == RobotState::MOVING) {
            checkBlockedRoute();
            if (waiting_for_route) return;
        }

        if (state == RobotState::MOVING) {
            if (path_index < path.size()) {
                Waypoint target = path[path_index];
                float dx = target.x - x;
                float dy = target.y - y;
                float dist = std::sqrt(dx * dx + dy * dy);

                float step = speed * dt;
                if (step >= dist) {
                    x = target.x;
                    y = target.y;
                    path_index++;
                    distance_travelled += dist;
                } else {
                    x += (dx / dist) * step;
                    y += (dy / dist) * step;
                    distance_travelled += step;
                }
            } else {
                trips++;
                total_trips++;
                if (isAtDock()) {
                    state = RobotState::CHARGING;
                } else {
                    state = RobotState::IDLE;
                }
            }
        }
    }
};

std::vector<Robot> fleet;

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void init_fleet(int num_robots) {
        fleet.clear();
        for(int i = 0; i < num_robots; i++) {
            int dock_idx = i % CHARGING_DOCKS.size();
            fleet.emplace_back(i, CHARGING_DOCKS[dock_idx].x, CHARGING_DOCKS[dock_idx].y, dock_idx);
        }
    }

    EMSCRIPTEN_KEEPALIVE
    void update_simulation(float dt) {
        for(auto& robot : fleet) {
            robot.update(dt);
        }
    }

    EMSCRIPTEN_KEEPALIVE
    void assign_task(int robot_id, int target_x, int target_y) {
        if (robot_id < 0 || robot_id >= fleet.size()) return;
        Robot& r = fleet[robot_id];
        if (r.battery < 15.0f) return;

        int start_gx = static_cast<int>(std::round(r.x));
        int start_gy = static_cast<int>(std::round(r.y));

        if (r.loadPath(start_gx, start_gy, target_x, target_y)) {
            r.waiting_for_route = false;
            r.state = RobotState::MOVING;
        }
    }

    // ---------- Scenario A API ----------
    // Edge camera reports a cell as occupied (1) or free (0).
    // Occupied cells become dynamic obstacles; robots re-plan automatically.
    EMSCRIPTEN_KEEPALIVE
    void set_cell_occupied(int x, int y, int v) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return;
        if (grid[x][y] == 1 && !occupied[x][y]) return; // static rack/wall: ignore
        occupied[x][y] = v ? 1 : 0;
        grid[x][y] = v ? 1 : 0;
    }

    EMSCRIPTEN_KEEPALIVE
    int get_cell_occupied(int x, int y) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return 0;
        return occupied[x][y];
    }

    EMSCRIPTEN_KEEPALIVE
    void set_zone(int x0, int y0, int x1, int y1) {
        zone_x0 = std::min(x0, x1); zone_x1 = std::max(x0, x1);
        zone_y0 = std::min(y0, y1); zone_y1 = std::max(y0, y1);
    }

    EMSCRIPTEN_KEEPALIVE
    void set_zone_capacity(int c) { zone_capacity = c < 0 ? 0 : c; }

    EMSCRIPTEN_KEEPALIVE
    int get_zone_capacity() { return zone_capacity; }

    EMSCRIPTEN_KEEPALIVE
    int get_zone_occupied() { return zone_occupied_count(); }

    EMSCRIPTEN_KEEPALIVE
    int get_zone_full() { return zone_full() ? 1 : 0; }

    EMSCRIPTEN_KEEPALIVE
    int get_zone_bound(int i) {
        int b[4] = {zone_x0, zone_y0, zone_x1, zone_y1};
        return (i >= 0 && i < 4) ? b[i] : 0;
    }

    EMSCRIPTEN_KEEPALIVE
    void clear_occupancy() {
        for (int x = 0; x < GRID_WIDTH; x++)
            for (int y = 0; y < GRID_HEIGHT; y++)
                if (occupied[x][y]) { occupied[x][y] = 0; grid[x][y] = 0; }
    }

    EMSCRIPTEN_KEEPALIVE
    void reset_kpi() {
        total_replans = 0; total_trips = 0; total_detour_cells = 0.0f;
        for (auto& r : fleet) { r.distance_travelled = 0; r.replans = 0; r.trips = 0; }
    }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_distance(int id) { return (id >= 0 && id < (int)fleet.size()) ? fleet[id].distance_travelled : 0; }

    EMSCRIPTEN_KEEPALIVE
    int get_total_replans() { return total_replans; }

    EMSCRIPTEN_KEEPALIVE
    int get_total_trips() { return total_trips; }

    EMSCRIPTEN_KEEPALIVE
    float get_total_detour() { return total_detour_cells; }

    EMSCRIPTEN_KEEPALIVE
    int get_robot_waiting(int id) { return (id >= 0 && id < (int)fleet.size() && fleet[id].waiting_for_route) ? 1 : 0; }

    // Emergency Recall routing to the nearest dock
    EMSCRIPTEN_KEEPALIVE
    void emergency_recall(int robot_id) {
        if (robot_id < 0 || robot_id >= fleet.size()) return;
        Robot& r = fleet[robot_id];
        int start_gx = static_cast<int>(std::round(r.x));
        int start_gy = static_cast<int>(std::round(r.y));

        int best_dock_x = 0, best_dock_y = 0;
        int shortest_len = 99999;

        for (const auto& dock : CHARGING_DOCKS) {
            int p_len = calculate_path(start_gx, start_gy, static_cast<int>(dock.x), static_cast<int>(dock.y));
            if (p_len > 0 && p_len < shortest_len) {
                shortest_len = p_len;
                best_dock_x = static_cast<int>(dock.x);
                best_dock_y = static_cast<int>(dock.y);
            }
        }

        if (shortest_len > 0) {
            int path_len = calculate_path(start_gx, start_gy, best_dock_x, best_dock_y);
            if (path_len > 0) {
                r.path.clear();
                for (int i = 0; i < path_len; i++) {
                    r.path.push_back({(float)get_path_x(i), (float)get_path_y(i)});
                }
                r.path_index = 0;
                r.state = RobotState::MOVING;
            }
        }
    }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_x(int id) { return fleet[id].x; }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_y(int id) { return fleet[id].y; }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_battery(int id) { return fleet[id].battery; }

    EMSCRIPTEN_KEEPALIVE
    int get_robot_state(int id) { return static_cast<int>(fleet[id].state); }

    EMSCRIPTEN_KEEPALIVE
    int get_active_path_length(int robot_id) {
        if (robot_id < 0 || robot_id >= fleet.size()) return 0;
        if (fleet[robot_id].path_index >= fleet[robot_id].path.size()) return 0;
        return fleet[robot_id].path.size() - fleet[robot_id].path_index;
    }

    EMSCRIPTEN_KEEPALIVE
    float get_active_path_x(int robot_id, int index) {
        if (robot_id < 0 || robot_id >= fleet.size()) return 0;
        size_t idx = fleet[robot_id].path_index + index;
        if (idx < fleet[robot_id].path.size()) return fleet[robot_id].path[idx].x;
        return 0;
    }

    EMSCRIPTEN_KEEPALIVE
    float get_active_path_y(int robot_id, int index) {
        if (robot_id < 0 || robot_id >= fleet.size()) return 0;
        size_t idx = fleet[robot_id].path_index + index;
        if (idx < fleet[robot_id].path.size()) return fleet[robot_id].path[idx].y;
        return 0;
    }
}