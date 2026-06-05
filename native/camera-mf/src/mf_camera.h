#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <guiddef.h>
#include <map>
#include <mutex>
#include <string>
#include <vector>

struct IMFMediaSource;
struct IMFMediaType;
struct IMFSourceReader;
struct IMFSample;
class MfSourceReaderCallback;

#include "addon_shared.h"
#include "mf_controls.h"

struct MfCaptureProfile {
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t subtype_data1 = 0;
  uint64_t pixel_area = 0;
};

class MfCamera {
 public:
  bool Open(const std::string& device_id, int live_preview_max_long_edge, int capture_preview_max_long_edge);
  void Close();
  void ReleaseResources();
  bool IsOpen() const { return is_open_.load(std::memory_order_acquire); }
  MfCaptureProfile GetCaptureProfile() const;
  uint64_t PreviewFrameGeneration() const {
    return preview_frame_generation_.load(std::memory_order_acquire);
  }
  uint64_t RawFrameGeneration() const { return raw_frame_generation_.load(std::memory_order_acquire); }
  bool CopyPreviewJpeg(std::vector<uint8_t>& out);
  void OnReaderSample(IMFSample* sample, uint32_t stream_flags);
  void OnReaderInvalidated();
  bool ShouldAbortReader() const;
  void KickAsyncPreviewRead();
  void RequestPreviewEncode();
  bool ShouldChainPreviewRead() const;
  bool GrabStill(const std::string& capture_mode, std::vector<uint8_t>& preview_jpeg, std::vector<uint8_t>& source,
                 bool& source_is_png, int grab_preview_max_edge, int& out_source_width, int& out_source_height);
  bool GetCapabilities(std::map<std::string, CameraNumCap>& out);
  bool GetControlValues(std::map<std::string, double>& out);
  CameraControlApplyResult SetControlValues(const std::map<std::string, double>& partial);
  const std::string& LastError() const { return last_error_; }

 private:
  struct MfFormatProfile {
    uint32_t stream_index = 0;
    uint32_t type_index = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    GUID subtype{};
  };
  bool NegotiateFormatOnSource(IMFMediaSource* source, uint32_t& out_stream_index);
  bool ApplyPresentationProfile(IMFMediaSource* source, const MfFormatProfile& profile);
  bool ApplySourceFormatToReader(IMFMediaSource* source, uint32_t stream_index);
  bool ExtractRawBytesFromSample(IMFSample* sample, std::vector<uint8_t>& out) const;
  bool EncodeGrabOutputsFromBuffer(const std::vector<uint8_t>& buf, int width, int height, const GUID& subtype,
                                   int cap_edge, bool source_is_png, std::vector<uint8_t>& preview_jpeg,
                                   std::vector<uint8_t>& source) const;
  bool NegotiateFormatFromReader();
  bool ProbeBestNativeTypeOnStream(uint32_t stream_index, IMFMediaType** out_type, int* out_score);
  void UpdateFrameInfoFromMediaType(IMFMediaType* type);
  bool IngestSample(IMFSample* sample);
  void SchedulePreviewEncodeFromCache();
  bool EncodePreviewJpegFromFrame(const std::vector<uint8_t>& frame_bytes, int live_max_edge,
                                  std::vector<uint8_t>& preview_jpeg) const;
  bool CopyLatestSampleBytes(std::vector<uint8_t>& out);
  void WaitForPreviewEncodeIdle(int timeout_ms);

  std::atomic<bool> is_open_{false};
  std::atomic<uint64_t> preview_frame_generation_{0};
  std::atomic<uint64_t> raw_frame_generation_{0};
  std::atomic<bool> preview_encode_in_progress_{false};
  std::atomic<uint64_t> last_encoded_raw_generation_{0};
  /** v1: one MJPEG profile for live preview and capture. */
  MfFormatProfile stream_profile_{};
  bool manual_modes_forced_ = false;
  int live_max_ = 960;
  int capture_max_ = 960;
  int frame_width_ = 0;
  int frame_height_ = 0;
  GUID frame_subtype_ = {};
  std::string last_error_;
  std::string open_device_id_;
  std::vector<uint8_t> latest_preview_jpeg_;
  std::vector<uint8_t> latest_sample_bytes_;
  std::mutex preview_mu_;
  IMFMediaSource* source_ = nullptr;
  IMFSourceReader* reader_ = nullptr;
  MfSourceReaderCallback* reader_callback_ = nullptr;
  uint32_t video_stream_index_ = 0;
};

std::vector<CameraDevice> ListMfCameraDevices();

MfCamera& GetMfCamera();
void ShutdownMfCamera();
