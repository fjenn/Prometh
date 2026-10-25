import Foundation

enum RuntimeFailure:Error{case message(String)}
@main struct PublicWebTests {
    static func main() async throws {
        for ip:[UInt8] in [[127,0,0,1],[10,1,2,3],[172,16,0,1],[192,168,1,1],[169,254,169,254],[100,64,1,2],[0,0,0,0],[224,1,1,1]] {
            precondition(!PublicPagePolicy.publicIPv4(ip),"Private address admitted: \(ip)")
        }
        precondition(PublicPagePolicy.publicIPv4([8,8,8,8]))
        for raw in ["https://127.0.0.1/","https://localhost/","https://example.local/","https://name:secret@example.com/","https://example.com:8443/","http://example.com/"] {
            do {try await PublicPagePolicy.validate(URL(string:raw)!);fatalError("Unsafe address admitted: \(raw)")} catch {}
        }
        print("15 public-web address checks passed")
    }
}
