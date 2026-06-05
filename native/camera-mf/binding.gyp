{
  "targets": [
    {
      "target_name": "camera_mf",
      "sources": [
        "src/addon_module.cc",
        "src/addon_api.cc",
        "src/addon_api_async.cc",
        "src/addon_shared.cc",
        "src/camera_thread.cc",
        "src/preview_encode_thread.cc",
        "src/mf_camera.cc",
        "src/mf_source_reader_callback.cc",
        "src/mf_capture_control.cc",
        "src/mf_device_source.cc",
        "src/mf_controls.cc",
        "src/mf_hotplug.cc",
        "src/addon_hotplug.cc",
        "src/jpeg_wic.cc"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "UNICODE", "_UNICODE"],
            "libraries": [
              "mf.lib",
              "mfplat.lib",
              "mfuuid.lib",
              "mfreadwrite.lib",
              "ole32.lib",
              "oleaut32.lib",
              "windowscodecs.lib",
              "strmiids.lib",
              "Cfgmgr32.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ]
      ]
    }
  ]
}
