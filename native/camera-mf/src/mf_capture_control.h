#pragma once

#include <string>

void RequestCaptureAbort();
void ClearCaptureAbort();
bool ShouldAbortCapture();

/** Wall-clock open budget (ms) checked between Open steps on the camera thread. */
int GetOpenDeadlineMs();

void LogMfStep(const char* step);
