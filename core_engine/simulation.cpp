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
    CHARGING = 2
};

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

    Robot(int id, float start_x, float start_y, int dock_idx) 
        : id(id), x(start_x), y(start_y), battery(100.0f), speed(5.0f), state(RobotState::IDLE), path_index(0), assigned_dock_idx(dock_idx) {}

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
            battery += 35.0f * dt; // Fast dock regeneration
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
            // Find the closest charging dock via A* path length
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

        // Auto-lock into charging when arriving at any dock with low/moderate battery
        if (isAtDock() && battery < 85.0f && state != RobotState::CHARGING) {
            path.clear();
            state = RobotState::CHARGING;
            return;
        }

        // Movement Execution along Waypoints
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
                } else {
                    x += (dx / dist) * step;
                    y += (dy / dist) * step;
                }
            } else {
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
            // Assign each robot to start at its corresponding charging dock
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

        int path_length = calculate_path(start_gx, start_gy, target_x, target_y);
        if (path_length > 0) {
            r.path.clear();
            for (int i = 0; i < path_length; i++) {
                r.path.push_back({(float)get_path_x(i), (float)get_path_y(i)});
            }
            r.path_index = 0;
            r.state = RobotState::MOVING;
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