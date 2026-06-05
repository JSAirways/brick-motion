#pragma once

#include <atomic>
#include <windows.h>

#include <mfidl.h>
#include <mfreadwrite.h>

struct IMFSourceReader;
struct IMFSample;

class MfCamera;

/** Async IMFSourceReader callback — avoids blocking the camera thread on ReadSample. */
class MfSourceReaderCallback : public IMFSourceReaderCallback {
 public:
  static HRESULT Create(MfCamera* camera, MfSourceReaderCallback** out);

  void AttachReader(IMFSourceReader* reader, DWORD stream_index);
  void Detach();
  /** Returns false if ReadSample was rejected (e.g. MF_E_NOTACCEPTING). */
  bool RequestSample();
  /** Clears a stuck async read slot after flush / format switch. */
  void ResetReadPending();
  /** Waits until no async ReadSample is pending (bounded). */
  void WaitUntilIdle(int timeout_ms);

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override;
  STDMETHODIMP_(ULONG) AddRef() override;
  STDMETHODIMP_(ULONG) Release() override;
  STDMETHODIMP OnReadSample(HRESULT hr_status, DWORD stream_index, DWORD stream_flags, LONGLONG timestamp,
                            IMFSample* sample) override;
  STDMETHODIMP OnEvent(DWORD, IMFMediaEvent*) override { return S_OK; }
  STDMETHODIMP OnFlush(DWORD) override;

 private:
  ~MfSourceReaderCallback();
  ULONG ref_count_ = 1;
  MfCamera* camera_ = nullptr;
  IMFSourceReader* reader_ = nullptr;
  DWORD stream_index_ = 0;
  std::atomic<bool> read_pending_{false};
};
