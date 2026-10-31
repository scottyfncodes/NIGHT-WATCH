import './style.css';
import { Game } from './game';

const app = document.getElementById('app')!;
try {
  new Game(app);
} catch (err) {
  console.error(err);
  app.innerHTML = `<div class="fatal"><h1>NIGHT WATCH</h1><p>Your browser couldn't start WebGL. Try Safari or Chrome with hardware acceleration enabled.</p></div>`;
}
