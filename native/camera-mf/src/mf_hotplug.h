#pragma once

#include <functional>

using MfHotplugListener = std::function<void()>;

void StartMfHotplug(MfHotplugListener listener);
void StopMfHotplug();

/** Fired when the active MF capture stream is invalidated (unplug, driver reset). */
void SetMfDeviceInvalidatedListener(MfHotplugListener listener);
void NotifyMfDeviceInvalidated();
