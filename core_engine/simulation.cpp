#include <vector>
#include <cmath>
#include <emscripten/emscripten.h>

// 1. State Machine Definition
enum class RobotState {
    IDLE = 0,
    MOVING = 1,
    CHARGING = 2
};

// 2. Robot Class & Continuous-Time Mechanics
struct Robot {
    int id;
    float x;
    float y;
    float target_x;
    float target_y;
    float battery; // 0.0 - 100.0
    float speed;
    RobotState state;

    Robot(int id, float start_x, float start_y) 
        : id(id), x(start_x), y(start_y), target_x(start_x), target_y(start_y), 
          battery(100.0f), speed(50.0f), state(RobotState::IDLE) {}

    void update(float dt) {
        // Logika State: CHARGING
        if (state == RobotState::CHARGING) {
            battery += 15.0f * dt; // Baterai terisi seiring waktu
            if (battery >= 100.0f) {
                battery = 100.0f;
                state = RobotState::IDLE;
            }
            return;
        }

        // Logika Perlindungan Baterai (Fail-safe)
        if (battery < 20.0f && state != RobotState::CHARGING) {
            // Paksa robot kembali ke Charging Station (asumsi di koordinat 0,0)
            target_x = 0.0f;
            target_y = 0.0f;
            state = RobotState::MOVING;
        }

        // Logika State: MOVING (Kinematika Dasar)
        if (state == RobotState::MOVING) {
            float dx = target_x - x;
            float dy = target_y - y;
            float distance = std::sqrt(dx * dx + dy * dy);

            // Jika sudah sampai tujuan
            if (distance < 1.0f) {
                x = target_x;
                y = target_y;
                if (battery < 20.0f) {
                    state = RobotState::CHARGING;
                } else {
                    state = RobotState::IDLE;
                }
            } else {
                // Menghitung pergerakan berdasarkan delta time (dt)
                float move_dist = speed * dt;
                
                // Mencegah overshoot (kebablasan)
                if (move_dist > distance) move_dist = distance; 
                
                // Normalisasi vektor dan update posisi
                x += (dx / distance) * move_dist;
                y += (dy / distance) * move_dist;
                
                // Kurangi baterai saat bergerak
                battery -= 2.0f * dt; 
            }
        }
    }
};

// Global Fleet Manager
std::vector<Robot> fleet;

// 3. API Bridge untuk JavaScript (WebAssembly Interface)
extern "C" {
    
    // Inisialisasi armada robot
    EMSCRIPTEN_KEEPALIVE
    void init_fleet(int num_robots) {
        fleet.clear();
        for(int i = 0; i < num_robots; i++) {
            // Tempatkan robot berjejer di sumbu X
            fleet.emplace_back(i, i * 30.0f, 0.0f);
        }
    }

    // Dipanggil oleh requestAnimationFrame di JavaScript setiap frame
    EMSCRIPTEN_KEEPALIVE
    void update_simulation(float dt) {
        for(auto& robot : fleet) {
            robot.update(dt);
        }
    }

    // Memberikan perintah dari klik user di UI
    EMSCRIPTEN_KEEPALIVE
    void assign_task(int robot_id, float target_x, float target_y) {
        if (robot_id >= 0 && robot_id < fleet.size()) {
            if (fleet[robot_id].battery >= 20.0f) {
                fleet[robot_id].target_x = target_x;
                fleet[robot_id].target_y = target_y;
                fleet[robot_id].state = RobotState::MOVING;
            }
        }
    }

    // Getter untuk merender UI di JavaScript
    EMSCRIPTEN_KEEPALIVE
    float get_robot_x(int id) { return fleet[id].x; }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_y(int id) { return fleet[id].y; }

    EMSCRIPTEN_KEEPALIVE
    float get_robot_battery(int id) { return fleet[id].battery; }

    EMSCRIPTEN_KEEPALIVE
    int get_robot_state(int id) { return static_cast<int>(fleet[id].state); }
}