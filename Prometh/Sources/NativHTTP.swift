import Foundation

public enum NativServerAuthorization {
    public static func authorize(_ request: inout URLRequest, apiKey: String?) {
        guard let apiKey = apiKey?.trimmingCharacters(in: .whitespacesAndNewlines),
              !apiKey.isEmpty else {
            return
        }
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    }
}

public enum NativServerErrorMessage {
    public static func detail(from responseBody: String) -> String? {
        let trimmedBody = responseBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty,
              let data = trimmedBody.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        if let detail = normalized(object["detail"] as? String) {
            return detail
        }
        if let error = object["error"] as? [String: Any],
           let message = normalized(error["message"] as? String) {
            return message
        }
        return normalized(object["error"] as? String)
    }

    public static func endpointFailure(
        endpoint: String,
        statusCode: Int,
        responseBody: String
    ) -> String {
        if let detail = detail(from: responseBody) {
            return detail
        }

        let trimmedBody = responseBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty else {
            return "\(endpoint) returned HTTP \(statusCode)"
        }
        return "\(endpoint) returned HTTP \(statusCode): \(trimmedBody)"
    }

    public static func modelLoadFailure(in text: String) -> String? {
        let structuredMessage = detail(from: text)
        let candidates = [structuredMessage, text].compactMap { $0 }
        let markers = [
            "Failed to load image generation model:",
            "Unsupported image generation model:",
            "Failed to load image edit model:",
            "Unsupported image edit model:",
            "Failed to load audio model:",
            "Unsupported audio model:",
            "Failed to load model:",
            "Model not found:",
        ]

        for candidate in candidates {
            for line in candidate.split(whereSeparator: \.isNewline).reversed() {
                let value = String(line)
                for marker in markers {
                    guard let range = value.range(
                        of: marker,
                        options: [.caseInsensitive]
                    ) else {
                        continue
                    }
                    return normalized(String(value[range.lowerBound...]))
                }

                guard let errorRange = value.range(
                    of: "Error loading model ",
                    options: [.caseInsensitive]
                ) else {
                    continue
                }
                let suffix = value[errorRange.upperBound...]
                guard let separator = suffix.range(of: ":"),
                      let reason = normalized(String(suffix[separator.upperBound...]))
                else {
                    continue
                }
                return "Failed to load model: \(reason)"
            }
        }
        return nil
    }


    public static func isPortConflictFailure(in text: String) -> Bool {
        let lowered = text.lowercased()
        return lowered.contains("address already in use")
            || lowered.contains("errno 48")
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty
        else {
            return nil
        }
        return value
    }
}
