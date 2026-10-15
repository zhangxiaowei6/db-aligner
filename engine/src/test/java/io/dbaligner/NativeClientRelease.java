package io.dbaligner;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipInputStream;

/** Opens the actual portable release rather than a checkout-local executable. */
final class NativeClientRelease {
  private NativeClientRelease() {}

  static Path extract(Path destination) throws IOException {
    var desktop =
        Json.MAPPER.readTree(Files.readString(Path.of("..", "desktop", "package.json")));
    var version = desktop.path("version").asText();
    var archive =
        Path.of("..", "release", "DBAligner-" + version + "-win-x64.zip")
            .toAbsolutePath()
            .normalize();
    if (!Files.isRegularFile(archive)) {
      throw new IOException("Build the full portable release before native smoke: " + archive);
    }
    Files.createDirectories(destination);
    try (var input = new ZipInputStream(Files.newInputStream(archive))) {
      for (var entry = input.getNextEntry(); entry != null; entry = input.getNextEntry()) {
        var output = destination.resolve(entry.getName()).normalize();
        if (!output.startsWith(destination) || output.equals(destination)) {
          throw new IOException("Invalid portable release entry: " + entry.getName());
        }
        if (entry.isDirectory()) {
          Files.createDirectories(output);
        } else {
          Files.createDirectories(output.getParent());
          Files.copy(input, output);
        }
        input.closeEntry();
      }
    }
    var executable = destination.resolve("DBAligner.exe");
    if (!Files.isRegularFile(executable)) {
      throw new IOException("Portable release is missing DBAligner.exe");
    }
    return executable;
  }
}
