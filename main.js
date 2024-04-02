import "./style.css";
import { setupButton } from "./dm_project.js";


document.querySelector("#app").innerHTML = `
  <div>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
  </div>
`;


setupButton(document.querySelector("#counter"));
