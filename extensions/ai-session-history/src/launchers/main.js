import { LaunchersManager } from "@/launchers/manager";
import "@/styles/global.css";

const root = document.getElementById("root");
if (root) {
  const app = new LaunchersManager(root);
  app.start();
}
