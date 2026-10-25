import Foundation
import Darwin

/// Public page reading must not let model-produced URLs reach local services.
/// Redirects are refused so a public URL cannot silently change its destination.
final class PublicPageRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
enum PublicPagePolicy {
    static func publicIPv4(_ bytes: [UInt8]) -> Bool {
        guard bytes.count==4 else{return false}
        let a=bytes[0],b=bytes[1]
        return !(a==0 || a==10 || a==127 || a>=224 || (a==100 && (64...127).contains(b)) || (a==169 && b==254) || (a==172 && (16...31).contains(b)) || (a==192 && (b==168 || b==0)) || (a==198 && (b==18 || b==19)))
    }
    static func publicAddress(_ address: UnsafePointer<sockaddr>) -> Bool {
        if Int32(address.pointee.sa_family)==AF_INET {
            let value=UnsafeRawPointer(address).assumingMemoryBound(to:sockaddr_in.self).pointee.sin_addr
            return withUnsafeBytes(of:value){publicIPv4(Array($0))}
        }
        if Int32(address.pointee.sa_family)==AF_INET6 {
            let value=UnsafeRawPointer(address).assumingMemoryBound(to:sockaddr_in6.self).pointee.sin6_addr
            return withUnsafeBytes(of:value){ raw in
                let bytes=Array(raw)
                // Only global unicast. This also excludes mapped IPv4, loopback,
                // link-local, unique-local and multicast destinations.
                return bytes.count==16 && (bytes[0] & 0xe0)==0x20
            }
        }
        return false
    }
    static func validate(_ url:URL) async throws {
        guard url.scheme=="https",url.user==nil,url.password==nil,(url.port==nil || url.port==443),let host=url.host,host.contains("."),!host.hasSuffix(".local"),!host.hasSuffix(".localhost") else{throw RuntimeFailure.message("Only public HTTPS page addresses are supported.")}
        let allowed=await Task.detached(priority:.utility){
            var result:UnsafeMutablePointer<addrinfo>?
            guard getaddrinfo(host,nil,nil,&result)==0,let first=result else{return false}
            defer{freeaddrinfo(first)}
            var cursor:UnsafeMutablePointer<addrinfo>?=first
            while let current=cursor {
                guard let addr=current.pointee.ai_addr,publicAddress(UnsafePointer(addr)) else{return false}
                cursor=current.pointee.ai_next
            }
            return true
        }.value
        guard allowed else{throw RuntimeFailure.message("This address resolves to a private or unsupported network.")}
    }
}
