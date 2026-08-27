# AMR Fleet Real-Time Simulator

A high-performance industrial digital twin simulation for Autonomous Mobile Robots (AMRs), built using a native C++ simulation engine compiled to WebAssembly (WASM) and a React-based presentation layer.

## Live Demo

[Access the Live Simulation](https://amr-wasm-simulator.vercel.app/)

## Project Overview

Modern automated manufacturing and logistics environments require deterministic, low-latency coordination for multi-robot fleets. This project models a warehouse floor digital twin to evaluate runtime kinematics, path planning concepts, and autonomous power management under constrained conditions.

To achieve industrial-grade performance without server infrastructure overhead, the heavy computational logic runs entirely on the client-side edge via WebAssembly, decoupling physical calculations from the UI rendering thread.

## Core Engineering Features

* **C++ WebAssembly Core:** The simulation engine is written in native C++ and compiled via Emscripten, enabling heavy continuous-time math and matrix processing to execute directly in the browser with near-native speed.
* **Deterministic State Machines:** Robots independently manage their operational states (`IDLE`, `MOVING`, `CHARGING`) based on real-time telemetry and triggers.
* **Continuous-Time Kinematics:** Motion calculations rely on delta-time scaling, ensuring physics updates remain frame-rate independent regardless of client hardware performance.
* **Client-Serverless Architecture:** Completely serverless design running entirely in the browser, eliminating hosting latency, WebSocket overhead, and backend idle costs.

## State Machine & Autonomous Charging Mechanics

The simulation incorporates a robust safety and energy management lifecycle:

1. **IDLE State:** Robots stand by at designated grid nodes, continuously evaluating task queues and battery levels.
2. **MOVING State:** Upon receiving a task coordinate, vector kinematics calculate optimal displacement per frame, steadily depleting energy reserves per second of motion.
3. **Autonomous Fail-Safe & CHARGING State:**
* **Critical Threshold:** If a robot's battery drops below 20%, an automated fail-safe overrides current instructions and re-routes the unit back to the charging dock at coordinate `(0,0)`.
* **Stationary Regeneration:** Upon docking, spatial movement is paused while energy is regenerated using continuous-time equations until capacity reaches 100%.
* **State Recovery:** Once fully charged, the robot automatically transitions back to `IDLE`, ready for new dispatch assignments.



## System Architecture

```
+-------------------------------------------------------+
|                      Browser                          |
|                                                       |
|  +--------------------+      cwrap / Memory Bridge    |
|  |   React Frontend   | <---------------------------+ |
|  |  (Canvas 60 FPS)   |                             | |
|  +--------------------+                             | |
|            ^                                        | |
|            | requestAnimationFrame                  v |
|            |                              +-----------+---+
|            +----------------------------> | C++ Engine    |
|                                           | (WASM Binary) |
|                                           +---------------+
+-------------------------------------------------------+

```

## Local Development & Compilation

### Prerequisites

* Node.js (v18 or higher)
* Emscripten SDK (`emsdk`) for C++ compilation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/AMR-WASM-Simulator.git
cd AMR-WASM-Simulator

```

### 2. Compile C++ to WebAssembly

Activate your Emscripten environment, then execute the build script to compile the core engine:

```bash
bash core_engine/build.sh

```

*(This updates `engine.js` and `engine.wasm` inside `web_ui/public/`)*

### 3. Run the Frontend UI

```bash
cd web_ui
npm install
npm run dev

```

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

Developed by Dedy Van Hauten