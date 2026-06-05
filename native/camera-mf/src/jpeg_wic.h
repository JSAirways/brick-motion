#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

bool EncodeJpegWic(const uint8_t* bgr, int width, int height, int stride, std::vector<uint8_t>& out);
bool EncodeJpegWicMaxLongEdge(const uint8_t* bgr, int width, int height, int stride, int max_long_edge,
                              std::vector<uint8_t>& out);
bool DownscaleJpegMaxLongEdge(const uint8_t* jpg, size_t jpg_len, int max_long_edge, std::vector<uint8_t>& out);
bool DecodeJpegToRgbaWic(const uint8_t* jpg, size_t jpg_len, std::vector<uint8_t>& rgba, int& width, int& height);
bool EncodePngRgbaWic(const uint8_t* rgba, int width, int height, std::vector<uint8_t>& out);
