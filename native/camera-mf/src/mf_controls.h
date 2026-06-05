#pragma once

#include <map>
#include <string>
#include <tuple>
#include <vector>

struct IMFMediaSource;

using CameraNumCap = std::tuple<double, double, double>;

struct CameraControlApplyResult {
  std::vector<std::string> applied;
  std::map<std::string, std::string> failed;
  std::vector<std::string> ignoredUnknown;
  std::vector<std::string> unsupported;
};

void ForceManualCameraModes(IMFMediaSource* source);
bool GetMfControlCapabilities(IMFMediaSource* source, std::map<std::string, CameraNumCap>& out);
bool GetMfControlValues(IMFMediaSource* source, std::map<std::string, double>& out);
CameraControlApplyResult SetMfControlValues(IMFMediaSource* source, const std::map<std::string, double>& partial);
