#include <vector>
#include <cmath>
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

struct Robot {
    int id;
    float x;
    float y;
    float battery;
    float speed;
    RobotState state;
    std::vector<Waypoint> path;
    size_t path_index;

    Robot(int id, float start_x, float start_y) 
        : id(id), x(start_x), y(start_y), battery(100.0f), speed(6.0f), state(RobotState::IDLE), path_index(0) {}

    void update(float dt) {
        if (state == RobotState::CHARGING) {
            battery += 40.0f * dt; // Fast charging at dock
            if (battery >= 100.0f) {
                battery = 100.0f;
                state = RobotState::IDLE;
            }
            return;
        }

        // Drain battery while active
        if (state == RobotState::MOVING) {
            battery -= 25.0f * dt;
            if (battery < 0.0f) battery = 0.0f;
        }

        int start_gx = static_cast<int>(std::round(x));
        int start_gy = static_cast<int>(std::round(y));

        // Dynamic Distance-to-Dock Evaluation Method
        bool already_heading_home = !path.empty() && path.back().x == 0.0f && path.back().y == 0.0f;
        if (state != RobotState::CHARGING && !already_heading_home) {
            // Check exact path length to charging station (0,0) via A*
            int path_len_to_dock = calculate_path(start_gx, start_gy, 0, 0);
            
            // Estimate energy required: drain rate per second / speed = cost per grid unit
            float energy_per_unit = 25.0f / speed; 
            float estimated_energy_needed = static_cast<float>(path_len_to_dock) * energy_per_unit;
            float safety_margin_buffer = 12.0f; // 12% safety buffer for unexpected detours

            // If current battery cannot safely cover the dynamic path home, trigger fail-safe re-routing
            if (battery <= (estimated_energy_needed + safety_margin_buffer)) {
                if (path_len_to_dock > 0 && (start_gx != 0 || start_gy != 0)) {
                    path.clear();
                    for (int i = 0; i < path_len_to_dock; i++) {
                        path.push_back({(float)get_path_x(i), (float)get_path_y(i)});
                    }
                    path_index = 0;
                    state = RobotState::MOVING;
                }
            }
        }

        // If already at dock and low battery, lock into charging state
        if (start_gx == 0 && start_gy == 0 && battery < 50.0f && state != RobotState::CHARGING) {
            path.clear();
            state = RobotState::CHARGING;
            return;
        }

        // Normal Movement Execution along Waypoints
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
                if (std::abs(x - 0.0f) < 0.1f && std::abs(y - 0.0f) < 0.1f) {
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
            fleet.emplace_back(i, 0.0f, static_cast<float>(i));
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

        if (r.battery < 15.0f) return; // Insufficient battery to accept new tasks

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