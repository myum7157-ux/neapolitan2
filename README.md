# Napolitan Relay Starter v12 (Full package)

This ZIP is a **complete project** (not a patch).
- Includes **all required code + manifests + placeholders** so it runs immediately.
- You keep your existing assets by simply **overwriting placeholders** with the same filenames.

## 1) Where to put your files

### BGM loops
Folder: `assets/audio/bgm/` (overwrite placeholders)

- `LOBBY_WAIT_LOOP.mp3`
- `ROOM_BASE_LOOP.mp3`
- `TENSION_LOW_LOOP.mp3`
- `TENSION_MID_LOOP.mp3`
- `NEAR_END_LOOP.mp3`

### SFX / stingers / layers
Folder: `assets/audio/sfx/` (overwrite placeholders)

- `sfx_ui_click_01.mp3`
- `sfx_ui_hover_01.mp3`
- `sfx_typewriter_tick_01.mp3`
- `sfx_stamp_thud_01.mp3`
- `sfx_paper_shuffle_01.mp3`
- `sfx_lock_beep_01.mp3`
- `sfx_access_granted_01.mp3`
- `sfx_access_denied_01.mp3`
- `sfx_queue_call_01.mp3`
- `sfx_door_metal_01.mp3`
- `sfx_death_hit_01.mp3`
- `sfx_share_capture_01.mp3`
- `layer_low_rumble_01.mp3`
- `layer_static_bed_01.mp3`
- `layer_fluorescent_hum_01.mp3`
- `layer_cable_noise_01.mp3`
- `sfx_string_stinger_01.mp3`
- `sfx_string_stinger_02.mp3`

### Images
Folder: `assets/images/`  
Everything in `data/manifests/images.json` points to files under `assets/images/`.
Replace placeholders with your real PNGs **using the same filenames**.

## 2) Local test (Windows)

### Option A: Python (recommended)
Python is free. If you have it installed:

```bat
cd <project-folder>
python -m http.server 5173
```

Then open:
`http://localhost:5173`

### Option B: Node (if you prefer)
```bat
cd <project-folder>
npx --yes http-server -p 5173
```

> If PowerShell blocks `npx` with execution-policy errors, run the same command in **cmd.exe**.

## 3) Deploy (Cloudflare Pages / GitHub Pages)
This is a static site. Upload the whole folder to GitHub and deploy with Pages/Cloudflare Pages.

⚠️ **Multiplayer queue / KV** requires a Cloudflare Worker + KV (static hosting alone can’t do it).
The front-end is ready to call the Worker endpoints — you’ll plug in your Worker URL/vars when you move to “진짜 잠금 + 큐”.

## 4) Manifests
- `data/manifests/images.json` — image keys → file paths
- `data/manifests/audio.json` — audio keys → file paths

If you rename any file, update the manifest key path accordingly (recommended: don’t rename — overwrite).


## Audio 폴더(v8 호환)
- v12 기본: `assets/audio/bgm`, `assets/audio/sfx`
- v8 호환으로 `assets/audio/loops` 폴더를 추가해두었습니다. (roomtone/정전기/형광등 등 레이어 루프용)
- `data/manifests/audio.json`에는 v8의 `bands/loops` 섹션을 유지했고, v12에서 추가한 SFX 키(12+6)도 포함되어 있습니다.
