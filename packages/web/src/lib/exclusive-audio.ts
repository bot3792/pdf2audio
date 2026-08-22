// Native <audio> elements know nothing about each other, so the chapter player and the chunk
// scrubber below it happily talk over one another. Pausing the others on play fixes every pair in
// the app at once, including any player added later.
export function installExclusiveAudio() {
  document.addEventListener(
    "play",
    (event) => {
      const started = event.target;
      if (!(started instanceof HTMLAudioElement)) return;
      for (const other of document.querySelectorAll("audio")) {
        if (other !== started) other.pause();
      }
    },
    true,
  );
}
