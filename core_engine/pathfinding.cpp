#include <vector>
#include <cmath>
#include <queue>
#include <emscripten/emscripten.h>

#define GRID_WIDTH 20
#define GRID_HEIGHT 20

// 0 = Jalan Bebas, 1 = Rintangan/Rak Gudang
int grid[GRID_WIDTH][GRID_HEIGHT] = {0};

// Struktur untuk menyimpan koordinat
struct Point {
    int x, y;
};

// Vektor global untuk menyimpan rute terakhir yang berhasil dihitung
std::vector<Point> last_path;

// Struktur Node untuk algoritma A*
struct AStarNode {
    int x, y;
    float g_cost; // Biaya dari titik awal
    float f_cost; // g_cost + h_cost (estimasi ke tujuan)

    // Operator untuk priority queue (mengutamakan f_cost terkecil)
    bool operator>(const AStarNode& other) const {
        return f_cost > other.f_cost;
    }
};

// Fungsi Heuristik: Manhattan Distance (cocok untuk pergerakan grid/kotak)
float heuristic(int x1, int y1, int x2, int y2) {
    return std::abs(x1 - x2) + std::abs(y1 - y2);
}

extern "C" {

    // API untuk JavaScript: Mengatur posisi rintangan (rak gudang)
    EMSCRIPTEN_KEEPALIVE
    void set_obstacle(int x, int y, int is_obstacle) {
        if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
            grid[x][y] = is_obstacle;
        }
    }

    // API Utama: Menghitung rute dari Start ke Goal
    // Mengembalikan jumlah langkah (panjang rute), atau -1 jika jalan buntu
    EMSCRIPTEN_KEEPALIVE
    int calculate_path(int start_x, int start_y, int goal_x, int goal_y) {
        last_path.clear();

        // Validasi input
        if (start_x < 0 || start_x >= GRID_WIDTH || start_y < 0 || start_y >= GRID_HEIGHT ||
            goal_x < 0 || goal_x >= GRID_WIDTH || goal_y < 0 || goal_y >= GRID_HEIGHT) {
            return -1; 
        }
        
        // Jika titik tujuan adalah rintangan
        if (grid[goal_x][goal_y] == 1) return -1;

        // Matriks untuk menyimpan Node asal (parent) untuk merekonstruksi rute
        Point parent[GRID_WIDTH][GRID_HEIGHT];
        float g_costs[GRID_WIDTH][GRID_HEIGHT];
        bool closed_list[GRID_WIDTH][GRID_HEIGHT];

        // Inisialisasi matriks
        for (int i = 0; i < GRID_WIDTH; i++) {
            for (int j = 0; j < GRID_HEIGHT; j++) {
                parent[i][j] = {-1, -1};
                g_costs[i][j] = 999999.0f; // Nilai tak hingga
                closed_list[i][j] = false;
            }
        }

        std::priority_queue<AStarNode, std::vector<AStarNode>, std::greater<AStarNode>> open_list;

        // Masukkan titik awal
        g_costs[start_x][start_y] = 0;
        open_list.push({start_x, start_y, 0, heuristic(start_x, start_y, goal_x, goal_y)});

        // Arah pergerakan: Atas, Bawah, Kiri, Kanan
        int dx[] = {0, 0, -1, 1};
        int dy[] = {-1, 1, 0, 0};

        while (!open_list.empty()) {
            AStarNode current = open_list.top();
            open_list.pop();

            int cx = current.x;
            int cy = current.y;

            // Jika sampai di tujuan
            if (cx == goal_x && cy == goal_y) {
                // Rekonstruksi rute dari belakang
                int curr_x = goal_x;
                int curr_y = goal_y;
                while (curr_x != start_x || curr_y != start_y) {
                    last_path.push_back({curr_x, curr_y});
                    Point p = parent[curr_x][curr_y];
                    curr_x = p.x;
                    curr_y = p.y;
                }
                return last_path.size(); // Sukses
            }

            if (closed_list[cx][cy]) continue;
            closed_list[cx][cy] = true;

            // Cek tetangga (4 arah)
            for (int i = 0; i < 4; i++) {
                int nx = cx + dx[i];
                int ny = cy + dy[i];

                // Jika di dalam batas grid dan bukan rintangan
                if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && grid[nx][ny] == 0) {
                    float new_g = g_costs[cx][cy] + 1.0f; // Biaya per langkah = 1

                    if (new_g < g_costs[nx][ny]) {
                        g_costs[nx][ny] = new_g;
                        parent[nx][ny] = {cx, cy};
                        float f_cost = new_g + heuristic(nx, ny, goal_x, goal_y);
                        open_list.push({nx, ny, new_g, f_cost});
                    }
                }
            }
        }

        return -1; // Tidak ada rute yang ditemukan
    }

    // Karena WebAssembly agak rumit jika melempar struktur Array/Vector kompleks ke JavaScript,
    // Kita buatkan fungsi *getter* sederhana untuk diambil oleh JS.
    
    EMSCRIPTEN_KEEPALIVE
    int get_path_x(int index) {
        // Ingat, vektor last_path tersusun terbalik (dari target ke start)
        // Kita balik indeksnya agar JS membacanya dari start ke target
        int real_index = last_path.size() - 1 - index;
        if (real_index >= 0 && real_index < last_path.size()) return last_path[real_index].x;
        return -1;
    }

    EMSCRIPTEN_KEEPALIVE
    int get_path_y(int index) {
        int real_index = last_path.size() - 1 - index;
        if (real_index >= 0 && real_index < last_path.size()) return last_path[real_index].y;
        return -1;
    }
}