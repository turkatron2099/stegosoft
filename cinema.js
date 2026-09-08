// A short loop of public-domain films, streamed straight from Internet
// Archive. Uses a plain <video> (not IA's iframe embed, which has no loop
// option) so the "ended" event can advance to the next film and wrap back
// to the first — a real loop across the whole playlist, not just one movie.
//
// Each entry's identifier/file was picked by hand: Internet Archive has many
// uploads of these titles (including trailers and clip shows mixed in with
// the actual films), so each one here was checked against the real runtime
// and confirmed to have a proper small "streaming derivative" file (either
// IA's "h.264 IA" format or their older "512Kb MPEG4" one) rather than a
// large non-web-optimized original that stalls trying to load.
(() => {
  const IA = (identifier, file) => ({
    identifier,
    src: `https://archive.org/download/${identifier}/${encodeURIComponent(file)}`,
    poster: `https://archive.org/services/img/${identifier}`,
    detailsUrl: `https://archive.org/details/${identifier}`,
  });

  const PLAYLIST = [
    {
      title: "A Trip to the Moon",
      year: 1902,
      blurb: "A group of astronomers travel to the Moon by cannon-fired capsule, tangle with its native Selenites, and make a daring escape. Georges Méliès's groundbreaking special-effects short — the moon-in-the-eye shot is one of the most reproduced images in film history.",
      ...IA("a-trip-to-the-moon_202501", "A Trip To The Moon.ia.mp4"),
    },
    {
      title: "Metropolis",
      year: 1927,
      blurb: "In a towering future city, the son of its ruling industrialist falls for a worker who preaches peace between the classes — until a mad scientist's robot double of her sets out to destroy that hope. Fritz Lang's silent epic, one of the most influential science-fiction films ever made.",
      ...IA("metropolis-1927-english-titles", "Metropolis-1927-EnglishTitles.ia.mp4"),
    },
    {
      title: "The Phantom Empire",
      year: 1935,
      blurb: "Singing cowboy Gene Autry defends his radio-ranch home from villains after its land, all while a lost underground civilization 20,000 years advanced schemes against the surface world. A wonderfully strange sci-fi/western serial, all 12 chapters back to back.",
      ...IA("PhotosbyHaroldThePhantomEmpireAll12Chapters", "Phantom_Empire_512kb.mp4"),
    },
    {
      title: "Plan 9 From Outer Space",
      year: 1959,
      blurb: "Aliens resurrect the dead as zombies and vampires in a scheme to stop humanity from creating a doomsday weapon. Written and directed by Ed Wood, and widely regarded as one of the greatest bad movies ever made.",
      ...IA("plan-9-from-outer-space_202011", "Plan 9 from Outer Space   Ed Wood (full movie).ia.mp4"),
    },
    {
      title: "Carnival of Souls",
      year: 1962,
      blurb: "The lone survivor of a car accident drifts to a new town, drawn again and again toward an abandoned lakeside pavilion — and pursued by a ghoulish figure only she can see. A low-budget indie horror with a dreamlike, unsettling atmosphere way ahead of its time.",
      ...IA("carnival_of_souls", "carnival_of_souls_512kb.mp4"),
    },
    {
      title: "The Last Man on Earth",
      year: 1964,
      blurb: "The sole survivor of a pandemic that turned the rest of humanity into vampiric creatures holes up by day and fights them off by night. Vincent Price stars in the first screen adaptation of Richard Matheson's I Am Legend.",
      ...IA("the-last-man-on-earth-1964_202607", "the last man on earth-1964.ia.mp4"),
    },
    {
      title: "Night of the Living Dead",
      year: 1968,
      blurb: "Strangers barricade themselves in a farmhouse as the recently dead return to life with a taste for the living. George Romero's debut invented the modern zombie film — and fell into the public domain when its distributor's title-card mistake omitted the copyright notice.",
      ...IA("night-of-the-living-dead-mp-4-burned", "NightOfTheLivingDead (mp4)-BURNED.ia.mp4"),
    },
  ];

  const player = document.getElementById("cinema-player");
  const titleEl = document.getElementById("cinema-title");
  const blurbEl = document.getElementById("cinema-blurb");
  const sourceLink = document.getElementById("cinema-source-link");
  const playlistEl = document.getElementById("cinema-playlist");

  let currentIndex = 0;

  function renderPlaylist() {
    playlistEl.innerHTML = "";
    PLAYLIST.forEach((movie, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cinema-playlist-item" + (i === currentIndex ? " is-playing" : "");
      item.textContent = `${movie.title} (${movie.year})`;
      item.addEventListener("click", () => play(i));
      playlistEl.appendChild(item);
    });
  }

  function play(index) {
    currentIndex = (index + PLAYLIST.length) % PLAYLIST.length;
    const movie = PLAYLIST[currentIndex];

    player.poster = movie.poster;
    player.src = movie.src;
    player.play().catch(() => {}); // ignore autoplay rejection; controls still let the user press play

    titleEl.innerHTML = `${movie.title} <span class="cinema-year">(${movie.year})</span>`;
    blurbEl.textContent = movie.blurb;
    sourceLink.href = movie.detailsUrl;

    renderPlaylist();
  }

  player.addEventListener("ended", () => play(currentIndex + 1));

  play(0);
})();
