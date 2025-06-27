import { ExtensionContext } from "@foxglove/extension";

import { initGPSTrackerPanel } from "./GPSTrackerPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "UMRT GPS Tracker", initPanel: initGPSTrackerPanel });
}
