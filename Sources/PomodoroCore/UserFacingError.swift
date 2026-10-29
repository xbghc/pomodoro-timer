import Foundation

/// Foundation's localizedDescription follows the OS language, not the SwiftUI locale.
public enum UserFacingError {
    public static func message(_ error: Error) -> String {
        if let error = error as? ValidationError { return error.message }
        if let error = error as? DecodingError {
            switch error {
            case let .keyNotFound(key, context):
                return "Missing required field: \(path(context.codingPath + [key]))."
            case let .typeMismatch(_, context):
                return "Incorrect value type at \(path(context.codingPath))."
            case let .valueNotFound(_, context):
                return "Missing value at \(path(context.codingPath))."
            case let .dataCorrupted(context):
                return "Invalid data at \(path(context.codingPath))."
            @unknown default:
                return "The file contains invalid data."
            }
        }
        let error = error as NSError
        let reason: String
        if error.domain == NSCocoaErrorDomain {
            switch error.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError:
                reason = "The requested file was not found."
            case NSFileReadNoPermissionError:
                reason = "Permission to read the file was denied."
            case NSFileWriteNoPermissionError:
                reason = "Permission to save the file was denied."
            case NSFileWriteOutOfSpaceError:
                reason = "There is not enough disk space to save the file."
            case NSFileReadCorruptFileError, NSPropertyListReadCorruptError:
                reason = "The file contains invalid data."
            default:
                reason = "The file operation could not be completed."
            }
        } else {
            reason = "The operation could not be completed."
        }
        return "\(reason) (\(error.domain), code \(error.code))"
    }

    private static func path(_ keys: [any CodingKey]) -> String {
        keys.isEmpty ? "the document root" : keys.map(\.stringValue).joined(separator: ".")
    }
}
