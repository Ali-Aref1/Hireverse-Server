class Stopwatch {
  constructor() {
    this.startTime = 0;
    this.elapsed = 0;
    this.running = false;
  }

  start() {
    if (!this.running) {
      this.startTime = performance.now() - this.elapsed;
      this.running = true;
    }
  }

  pause() {
    if (this.running) {
      this.elapsed = performance.now() - this.startTime;
      this.running = false;
    }
  }

  reset() {
    this.startTime = 0;
    this.elapsed = 0;
    this.running = false;
  }

  getTime() {
    return this.running
      ? performance.now() - this.startTime
      : this.elapsed;
  }

  getTimeFormatted() {
    const ms = Math.floor(this.getTime());
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const displaySeconds = String(seconds % 60).padStart(2, '0');
    const displayMilliseconds = String(ms % 1000).padStart(3, '0');
    return `${minutes}:${displaySeconds}.${displayMilliseconds}`;
  }
}
module.exports = Stopwatch;