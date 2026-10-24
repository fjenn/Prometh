import Foundation
import AppKit
import AVFoundation
@main struct MediaTests {
    @MainActor static func main() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1])
        func check(_ b:Bool,_ text:String){if !b{print("FAIL: \(text)");exit(1)};print("PASS: \(text)")}
        for name in ["gmail","drive","outlook","github"] {check(NSImage(contentsOf:root.appendingPathComponent("provider-\(name).png")) != nil,"Bundled \(name) logo decodes")}
        let image=root.appendingPathComponent("cliff-house-demo.png")
        check(NSImage(contentsOf:image) != nil,"Bundled image decodes")
        check(NSImage(contentsOf:root.appendingPathComponent("onboarding-dreamworld.png")) != nil,"Bundled selected dreamworld decodes")
        check(NSImage(contentsOf:root.appendingPathComponent("AppIcon.icns")) != nil,"Original app icon decodes")
        let exported=URL(fileURLWithPath:"/tmp/sovereign-export-check.png");try Data(contentsOf:image).write(to:exported)
        check(NSImage(contentsOf:exported) != nil,"Image export payload is decodable PNG")
        let clip=root.appendingPathComponent("cliff-house-demo.mp4"),asset=AVURLAsset(url:clip)
        let duration=try await asset.load(.duration);check(abs(duration.seconds-6)<0.05,"Bundled video is six seconds")
        let tracks=try await asset.loadTracks(withMediaType:.video);check(!tracks.isEmpty,"Video has real playable video track")
        let player=AVPlayer(url:clip);let sought=await player.seek(to:CMTime(seconds:2,preferredTimescale:600),toleranceBefore:.zero,toleranceAfter:.zero)
        check(sought && abs(player.currentTime().seconds-2)<0.1,"AVPlayer seeks to requested playhead")
        player.play();try await Task.sleep(for:.milliseconds(600));check(player.currentTime().seconds>2.1,"Actual video playback advances");player.pause();check(player.rate==0,"Pause stops playback")
        let audioURL=root.appendingPathComponent("voice-demo.wav");let audioFile=try AVAudioFile(forReading:audioURL);check(audioFile.length>100000,"Bundled voice WAV decodes")
        let audio=AVPlayer(url:audioURL);audio.play();try await Task.sleep(for:.milliseconds(600));check(audio.rate>0,"Real voice playback starts");check(audio.currentTime().seconds>0.1,"Voice playback advances");audio.pause();check(audio.rate==0,"Voice stop ends playback")
        let movie=URL(fileURLWithPath:"/tmp/sovereign-export-check.mp4");try Data(contentsOf:clip).write(to:movie);let exportedDuration=try await AVURLAsset(url:movie).load(.duration);check(abs(exportedDuration.seconds-6)<0.05,"Video export payload remains decodable")
        print("18 media checks passed.")
    }
}
