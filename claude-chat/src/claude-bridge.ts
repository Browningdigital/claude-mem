import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

export interface SendOptions {
  message: string;
  images?: { data: string; mime: string }[];
  sessionId?: string;
  workingDir?: string;
}

export class ClaudeBridge {
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private tempFiles: string[] = [];
  private buffer = "";

  get currentSessionId() {
    return this.sessionId;
  }

  setSessionId(id: string | null) {
    this.sessionId = id;
  }

  async send(
    opts: SendOptions,
    onEvent: (event: ClaudeEvent) => void
  ): Promise<void> {
    const { message, images, sessionId, workingDir } = opts;

    // Write images to temp files
    const imageFiles: string[] = [];
    if (images?.length) {
      const tempDir = join(tmpdir(), "claude-chat-images");
      await mkdir(tempDir, { recursive: true });
      for (const img of images) {
        const ext = img.mime.split("/")[1] || "png";
        const filePath = join(tempDir, `${randomUUID()}.${ext}`);
        const buf = Buffer.from(img.data, "base64");
        await writeFile(filePath, buf);
        imageFiles.push(filePath);
        this.tempFiles.push(filePath);
      }
    }

    const args: string[] = [
      "-p",
      message,
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    // Resume session if we have one
    const sid = sessionId || this.sessionId;
    if (sid === "__latest__") {
      args.push("--continue");
    } else if (sid) {
      args.push("--resume", sid);
    }

    // Attach images
    for (const f of imageFiles) {
      args.push("--file", f);
    }

    return new Promise((resolve, reject) => {
      this.process = spawn("claude", args, {
        cwd: workingDir || process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.buffer = "";

      this.process.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split("\n");
        // Keep the last incomplete line in the buffer
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as ClaudeEvent;
            // Capture session ID from result
            if (event.session_id) {
              this.sessionId = event.session_id as string;
            }
            onEvent(event);
          } catch {
            // Partial JSON or non-JSON line, ignore
          }
        }
      });

      this.process.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          onEvent({ type: "stderr", content: text });
        }
      });

      this.process.on("close", (code) => {
        // Flush remaining buffer
        if (this.buffer.trim()) {
          try {
            const event = JSON.parse(this.buffer) as ClaudeEvent;
            if (event.session_id) {
              this.sessionId = event.session_id as string;
            }
            onEvent(event);
          } catch {
            // ignore
          }
        }
        this.process = null;
        onEvent({ type: "done", code, session_id: this.sessionId });
        resolve();
      });

      this.process.on("error", (err) => {
        onEvent({ type: "error", message: err.message });
        reject(err);
      });
    });
  }

  abort() {
    if (this.process) {
      this.process.kill("SIGINT");
    }
  }

  async cleanup() {
    for (const f of this.tempFiles) {
      try {
        await unlink(f);
      } catch {
        // already gone
      }
    }
    this.tempFiles = [];
  }
}
