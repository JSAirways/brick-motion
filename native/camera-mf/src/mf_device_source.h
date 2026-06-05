#pragma once

#include <string>

struct IMFMediaSource;

/** Creates a vidcap source from symbolic link on the camera thread (COM/MF already initialized). */
bool CreateMfDeviceSource(const std::wstring& symbolic_link, IMFMediaSource** out_source, std::string& error_out);
