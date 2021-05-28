const CLIENT_ID = "844874dd7c9e407ea670623190f7143e";
const SCOPES =
  "user-modify-playback-state user-read-playback-state user-read-currently-playing";
const REDIRECT_URI = "http://localhost:8080";

const appConfig = {
  getVerifier: () => localStorage.getItem("verifier"),
  setVerifier: (value) => localStorage.setItem("verifier", value),
  getState: () => localStorage.getItem("state"),
  setState: (value) => localStorage.setItem("state", value),
  getAccessToken: () => localStorage.getItem("access_token"),
  setAccessToken: (value) => localStorage.setItem("access_token", value),
  getRefreshToken: () => localStorage.getItem("refresh_token"),
  setRefreshToken: (value) => localStorage.setItem("refresh_token", value),
  getScopes: () => localStorage.getItem("scopes"),
  setScopes: (value) => localStorage.setItem("scopes", value),
};

async function authorizeSpotify(verifier, state) {
  const challenge = await generateChallenge(verifier);

  const redirectUrl = generateAuthUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    state,
    challenge,
  });
  window.location.replace(redirectUrl);
}

function generateAuthUrl(options) {
  const { clientId, redirectUri, scopes, state, challenge } = options;
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
    scopes
  )}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(
    challenge
  )}&code_challenge_method=S256`;
}

async function makeTokenRequest(requestData) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestData,
  });
  const result = await response.json();
  appConfig.setAccessToken(result.access_token);
  appConfig.setRefreshToken(result.refresh_token);
  console.log(result);
  appConfig.setScopes(result.scope);
}

async function requestToken(code) {
  console.log("Requesting new token");

  const data = new URLSearchParams();
  data.append("client_id", CLIENT_ID);
  data.append("grant_type", "authorization_code");
  data.append("code", code);
  data.append("redirect_uri", REDIRECT_URI);
  data.append("code_verifier", appConfig.getVerifier());

  await makeTokenRequest(data);
}

async function refreshToken() {
  const data = new URLSearchParams();
  data.append("client_id", CLIENT_ID);
  data.append("grant_type", "refresh_token");
  data.append("refresh_token", appConfig.getRefreshToken());

  await makeTokenRequest(data);
}

function generateRandomString(length) {
  const dec2hex = (dec) => ("0" + dec.toString(16)).substr(-2);

  const array = new Uint32Array(length / 2);
  window.crypto.getRandomValues(array);
  return Array.from(array, dec2hex).join("");
}

function sha256(plain) {
  // returns promise ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(a) {
  var str = "";
  var bytes = new Uint8Array(a);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateChallenge(verifier) {
  hashed = await sha256(verifier);
  base64encoded = base64urlencode(hashed);
  return base64encoded;
}

async function makeSpotifyRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${appConfig.getAccessToken()}`,
    },
    ...options,
  });

  if (response.status === 204) {
    return;
  }

  const data = await response.json();

  if (
    !response.ok &&
    data.error &&
    data.error.message === "The access token expired"
  ) {
    console.log("Spotify token expired");
    await refreshToken();
    return makeSpotifyRequest(url);
  }

  return data;
}

async function authorizationComplete() {
  const profile = await makeSpotifyRequest("https://api.spotify.com/v1/me");

  console.log(profile);

  document.getElementById(
    "test-content"
  ).innerHTML = `<p>Hi <a href="${profile.external_urls.spotify}" target="_blank">${profile.display_name}</a>!</p>`;

  const searchResult = await makeSpotifyRequest(
    "https://api.spotify.com/v1/search?q=amsterdam%20gregory&type=track&limit=1"
  );
  const track = searchResult.tracks.items[0];
  console.log(track);

  const devices = await makeSpotifyRequest(
    "https://api.spotify.com/v1/me/player/devices"
  );
  console.log(devices);

  await makeSpotifyRequest(
    `https://api.spotify.com/v1/me/player/play?device_id=${devices.devices[0].id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        uris: [track.uri],
      }),
    }
  );

  //
  setInterval(async () => {
    const status = await makeSpotifyRequest(
      `https://api.spotify.com/v1/me/player`
    );
    scrubControl.value = status.progress_ms;
  }, 500);

  // Add slider
  const scrubControl = document.getElementById("scrub-control");
  scrubControl.removeAttribute("disabled");
  scrubControl.setAttribute("max", track.duration_ms);

  scrubControl.addEventListener("change", (event) => {
    makeSpotifyRequest(
      `https://api.spotify.com/v1/me/player/seek?position_ms=${event.target.value}`,
      {
        method: "PUT",
      }
    );
  });
}

async function initialize() {
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get("code");
  const stateParam = urlParams.get("state");

  if (appConfig.getAccessToken() && appConfig.getScopes() === SCOPES) {
    console.log("Existing token found");
    authorizationComplete();
  } else if (codeParam) {
    if (stateParam && stateParam === appConfig.getState()) {
      // Clear search params
      window.history.replaceState(null, null, window.location.pathname);
      try {
        await requestToken(codeParam);
        authorizationComplete();
      } catch (error) {
        console.error(error);
      }
    } else {
      console.error(
        `Invalid state param: ${stateParam}, expected: ${appConfig.getState()}`
      );
    }
  } else {
    console.log("No token found or scope mismatch, initiating authorization");
    const verifier = generateRandomString(64);
    appConfig.setVerifier(verifier);

    const state = generateRandomString(10);
    appConfig.setState(state);

    try {
      await authorizeSpotify(verifier, state);
    } catch (error) {
      console.error("Failed to initiate authorization");
    }
  }
}

initialize();
