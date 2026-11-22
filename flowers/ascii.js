// Turns any canvas into coloured ASCII on the GPU: one fragment shader samples the source at each
// cell centre, picks a glyph from luminance (or - \ | / on strong Sobel edges) and tints it.
// Usage: const a = Ascii(canvas, { fontPx: (W, H) => px, ramp }); const grid = a.resize(); a.draw(sourceCanvas);
function Ascii(canvas, opts = {}) {
  const RAMP = opts.ramp || " .'`^\",:;Il!i><~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const GLYPHS = RAMP + '-\\|/';
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL unavailable');
  const small = document.createElement('canvas'), sctx = small.getContext('2d');

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
precision highp float;
uniform sampler2D uScene, uAtlas;
uniform vec2 uGrid, uCell, uRes;
uniform float uN, uRampN, uEdge;
float lum(vec2 uv) { return dot(texture2D(uScene, uv).rgb, vec3(.299, .587, .114)); }
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uCell;
  vec2 cell = floor(p), f = fract(p);
  vec2 uv = (cell + .5) / uGrid, d = 1. / uGrid;
  vec3 c = texture2D(uScene, uv).rgb;
  float l = dot(c, vec3(.299, .587, .114));
  if (l < .04) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
  float idx = clamp(floor(pow(l, .85) * (uRampN - 1.) + .5), 1., uRampN - 1.);
  float gx = lum(uv + vec2(d.x, -d.y)) + 2. * lum(uv + vec2(d.x, 0.)) + lum(uv + d) - lum(uv - d) - 2. * lum(uv - vec2(d.x, 0.)) - lum(uv + vec2(-d.x, d.y));
  float gy = lum(uv + vec2(-d.x, d.y)) + 2. * lum(uv + vec2(0., d.y)) + lum(uv + d) - lum(uv - d) - 2. * lum(uv - vec2(0., d.y)) - lum(uv + vec2(d.x, -d.y));
  if (l > .1 && length(vec2(gx, gy)) / 4. > uEdge) idx = uRampN + floor(mod(degrees(atan(gy, gx)) + 112.5, 180.) / 45.);
  float m = texture2D(uAtlas, vec2((idx + f.x) / uN, f.y)).r;
  float b = min(1. / max(max(c.r, c.g), max(c.b, .004)), 1.35);
  gl_FragColor = vec4(c * b * m, 1.);
}`));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const tex = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t; };
  const sceneTex = tex(0, gl.NEAREST), atlasTex = tex(1, gl.LINEAR);
  gl.uniform1i(U('uScene'), 0); gl.uniform1i(U('uAtlas'), 1);
  gl.uniform1f(U('uN'), GLYPHS.length); gl.uniform1f(U('uRampN'), RAMP.length); gl.uniform1f(U('uEdge'), opts.edge ?? 0.45);

  const grid = {};
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight, fs = opts.fontPx(W, H);
    const font = `500 ${fs * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    const a = document.createElement('canvas'), ac = a.getContext('2d');
    ac.font = font;
    const cw = ac.measureText('M').width, ch = fs * dpr * (opts.lineHeight || 1.08), gw = Math.ceil(cw), gh = Math.ceil(ch);
    a.width = gw * GLYPHS.length; a.height = gh;
    ac.font = font; ac.fillStyle = '#fff'; ac.textAlign = 'center'; ac.textBaseline = 'middle';
    for (let i = 0; i < GLYPHS.length; i++) ac.fillText(GLYPHS[i], i * gw + gw / 2, gh / 2 + 0.5);
    gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    Object.assign(grid, { W, H, cw: cw / dpr, ch: ch / dpr, cols: Math.ceil(canvas.width / cw), rows: Math.ceil(canvas.height / ch) });
    small.width = grid.cols; small.height = grid.rows;
    gl.uniform2f(U('uGrid'), grid.cols, grid.rows); gl.uniform2f(U('uCell'), cw, ch); gl.uniform2f(U('uRes'), canvas.width, canvas.height);
    return grid;
  }
  // src: canvas or video, downscaled to one pixel per cell. With {fit: [w, h]} it is letterboxed to its own aspect;
  // {fade: 0..1} dims it (loop seams).
  function draw(src, { fit, fade = 1 } = {}) {
    sctx.clearRect(0, 0, grid.cols, grid.rows);
    if (fit) {
      const s = Math.min(grid.W / fit[0], grid.H / fit[1]), dw = fit[0] * s / grid.cw, dh = fit[1] * s / grid.ch;
      sctx.drawImage(src, (grid.cols - dw) / 2, (grid.rows - dh) / 2, dw, dh);
    } else sctx.drawImage(src, 0, 0, grid.cols, grid.rows);
    if (fade < 1) { sctx.fillStyle = `rgba(0,0,0,${1 - fade})`; sctx.fillRect(0, 0, grid.cols, grid.rows); }
    gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { resize, draw, grid };
}
