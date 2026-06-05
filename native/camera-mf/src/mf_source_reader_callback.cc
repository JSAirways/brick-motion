#include "mf_source_reader_callback.h"

#include "camera_thread.h"
#include "mf_camera.h"
#include "mf_capture_control.h"

#include <mferror.h>
#include <mfreadwrite.h>

#include <new>

HRESULT MfSourceReaderCallback::Create(MfCamera* camera, MfSourceReaderCallback** out) {
  if (!camera || !out) {
    return E_POINTER;
  }
  *out = nullptr;
  auto* cb = new (std::nothrow) MfSourceReaderCallback();
  if (!cb) {
    return E_OUTOFMEMORY;
  }
  cb->camera_ = camera;
  *out = cb;
  return S_OK;
}

MfSourceReaderCallback::~MfSourceReaderCallback() = default;

STDMETHODIMP MfSourceReaderCallback::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) {
    return E_POINTER;
  }
  if (riid == IID_IUnknown || riid == IID_IMFSourceReaderCallback) {
    *ppv = static_cast<IMFSourceReaderCallback*>(this);
    AddRef();
    return S_OK;
  }
  *ppv = nullptr;
  return E_NOINTERFACE;
}

STDMETHODIMP_(ULONG) MfSourceReaderCallback::AddRef() {
  return static_cast<ULONG>(InterlockedIncrement(reinterpret_cast<LONG*>(&ref_count_)));
}

STDMETHODIMP_(ULONG) MfSourceReaderCallback::Release() {
  const ULONG ref = static_cast<ULONG>(InterlockedDecrement(reinterpret_cast<LONG*>(&ref_count_)));
  if (ref == 0) {
    delete this;
  }
  return ref;
}

void MfSourceReaderCallback::AttachReader(IMFSourceReader* reader, const DWORD stream_index) {
  reader_ = reader;
  stream_index_ = stream_index;
  read_pending_.store(false, std::memory_order_release);
}

void MfSourceReaderCallback::Detach() {
  camera_ = nullptr;
  reader_ = nullptr;
  read_pending_.store(false, std::memory_order_release);
}

void MfSourceReaderCallback::ResetReadPending() {
  read_pending_.store(false, std::memory_order_release);
}

void MfSourceReaderCallback::WaitUntilIdle(const int timeout_ms) {
  const int step_ms = 5;
  for (int waited = 0; waited < timeout_ms; waited += step_ms) {
    if (!read_pending_.load(std::memory_order_acquire)) {
      return;
    }
    Sleep(static_cast<DWORD>(step_ms));
  }
}

bool MfSourceReaderCallback::RequestSample() {
  if (!reader_ || !camera_ || read_pending_.exchange(true, std::memory_order_acq_rel)) {
    return false;
  }
  const HRESULT hr = reader_->ReadSample(stream_index_, 0, nullptr, nullptr, nullptr, nullptr);
  if (FAILED(hr)) {
    read_pending_.store(false, std::memory_order_release);
    std::fprintf(stderr, "[camera_mf] ReadSample request failed: 0x%08lx\n", static_cast<unsigned long>(hr));
    return false;
  }
  return true;
}

STDMETHODIMP MfSourceReaderCallback::OnFlush(DWORD) {
  read_pending_.store(false, std::memory_order_release);
  return S_OK;
}

STDMETHODIMP MfSourceReaderCallback::OnReadSample(const HRESULT hr_status, const DWORD stream_index,
                                                  const DWORD stream_flags, const LONGLONG timestamp,
                                                  IMFSample* sample) {
  (void)stream_index;
  (void)timestamp;
  read_pending_.store(false, std::memory_order_release);

  MfCamera* cam = camera_;
  if (!cam) {
    if (sample) {
      sample->Release();
    }
    return S_OK;
  }

  // MF invokes this on an internal thread; WIC, IAM* controls, and ReadSample must run on our STA camera thread.
  if (hr_status == MF_E_VIDEO_RECORDING_DEVICE_INVALIDATED) {
    QueueOnCameraThread([cam]() { cam->OnReaderInvalidated(); });
    if (sample) {
      sample->Release();
    }
    if (!(stream_flags & MF_SOURCE_READERF_ENDOFSTREAM) && !ShouldAbortCapture()) {
      QueueOnCameraThread([cam]() {
        if (cam->IsOpen() && cam->ShouldChainPreviewRead()) {
          cam->KickAsyncPreviewRead();
        }
      });
    }
    return S_OK;
  }

  if (SUCCEEDED(hr_status) && sample) {
    sample->AddRef();
    QueueOnCameraThread([cam, sample, stream_flags]() {
      if (cam->IsOpen() && !ShouldAbortCapture()) {
        cam->OnReaderSample(sample, stream_flags);
      }
      sample->Release();
      if (cam->IsOpen() && !(stream_flags & MF_SOURCE_READERF_ENDOFSTREAM) && !ShouldAbortCapture() &&
          cam->ShouldChainPreviewRead()) {
        cam->KickAsyncPreviewRead();
      }
    });
    return S_OK;
  }

  if (sample) {
    sample->Release();
  }
  if (!(stream_flags & MF_SOURCE_READERF_ENDOFSTREAM) && !ShouldAbortCapture()) {
    QueueOnCameraThread([cam]() {
      if (cam->IsOpen() && cam->ShouldChainPreviewRead()) {
        cam->KickAsyncPreviewRead();
      }
    });
  }
  return S_OK;
}
