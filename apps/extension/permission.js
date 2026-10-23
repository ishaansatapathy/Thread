const result = document.getElementById("result");

document.getElementById("allow").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    result.textContent = "Done — go back to your Meet tab and press Start again. This tab will close.";
    setTimeout(() => window.close(), 1500);
  } catch {
    result.textContent = "Chrome blocked it. Click the mic icon in the address bar, choose Allow, then try again.";
  }
});
