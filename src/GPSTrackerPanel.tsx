import { Immutable, MessageEvent, PanelExtensionContext, SettingsTreeAction, Topic } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { property, set, values } from "lodash";

type Config = {
  navigationTopic?: string
}

function GPSTrackerPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [lastMessage, setLastMessage] = useState<undefined | MessageEvent>(); // state for the last message ("Current Position")
  // const [savedPositions, setSavedPositions] = useState<Array<{ name: String; latitude: number; longitude: number; timestamp: string, distance: number }>>([]); // state for saved positions
  const [savedPositions, setSavedPositions] = useState<Array<{ name: string; latitude: number; longitude: number; timestamp: string; distance: number, pinned: boolean }>>(() => {
    const initialState = context.initialState as { savedPositions?: Array<{ name: string; latitude: number; longitude: number; timestamp: string; distance: number, pinned: boolean }> };
    return initialState?.savedPositions ?? []; // Restore savedPositions or initialize as an empty array
  });

  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  // Init config variable
  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Config;

    const {
      navigationTopic = "",
    } = partialConfig;

    return { navigationTopic };
  });

  // filter navigation topics by message type
  const navigationTopics = useMemo(
    () => (topics ?? []).filter((topic) => topic.schemaName === "sensor_msgs/msg/NavSatFix"),
    [topics],
  );

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update") {
        const { path, value } = action.payload;

        setConfig((previous) => {
          const newConfig = { ...previous };
          set(newConfig, path.slice(1), value);
          return newConfig;
        });
      }
    },
    [context],
  );

  // Function to save the current GPS position
  const saveCurrentPosition = () => {
    if (lastMessage) {
      logToRosout("Saving current position...");
      const curretnNameInput = document.getElementById("current-tag-name") as HTMLInputElement;
      const name = curretnNameInput ? curretnNameInput.value : "-";

      const latitude = (lastMessage.message as any).latitude;
      const longitude = (lastMessage.message as any).longitude;
      const timestamp = new Date((lastMessage.message as any).header.stamp.sec * 1000 + (lastMessage.message as any).header.stamp.nsec / 1e6).toISOString();
      
      const distance = -1;
      const pinned = false;

      setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance, pinned }]);
    }
    else {
      logToRosout("FAILED");
    }
  };

  const saveCustomPosition = (name: string, latitude: number, longitude: number) => {
    const timestamp = new Date().toISOString();
    const distance = -1;
    const pinned = false;

    setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance, pinned }]);
  }

  
  const calculateDistance = (lat1: number, long1: number, lat2: number, long2: number) => {
    const EarthR = 6371000;
    const dLat = ((lat1 - lat2) * Math.PI) / 180;
    const dLon = ((long1 - long2) * Math.PI) / 180;
    const lati1 = (lat2 * Math.PI) / 180;
    const lati2 = (lat1 * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lati1) * Math.cos(lati2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return Math.round((EarthR * c) * 10) / 10; // output distance in meters
  }

const updateDistances = () => {
  // Find which radio is checked if not provided
  
  const radioButtons = document.querySelectorAll('input[name="compare"]');
  const index = Array.from(radioButtons).findIndex(radio => (radio as HTMLInputElement).checked);
  

  // If "Current Position" is selected (index 0)
  if (index === 0 && lastMessage) {
    // Calculate distances from current position to all saved positions
    const currentLat = (lastMessage.message as any).latitude;
    const currentLon = (lastMessage.message as any).longitude;

    setSavedPositions(prev =>
      prev.map(pos => ({
        ...pos,
        distance: calculateDistance(currentLat, currentLon, pos.latitude, pos.longitude)
      }))
    );
    // Optionally: store/display "0" for the current position's distance somewhere
    const currentDistanceElem = document.getElementById('current-distance');
    if (currentDistanceElem) {
      currentDistanceElem.innerText = "0 m";
    }
    return;
  }

  // If a saved position is selected (index > 0)
  if (index > 0 && savedPositions[index - 1] && lastMessage) {
    const selected = savedPositions[index - 1];
    const currentLat = (lastMessage.message as any).latitude;
    const currentLon = (lastMessage.message as any).longitude;

    setSavedPositions(prev =>
      prev.map((pos, i) => ({
        ...pos,
        distance: i === (index - 1) || selected == null
          ? 0
          : calculateDistance(selected.latitude, selected.longitude, pos.latitude, pos.longitude)
      }))
    );
    // Optionally: store/display distance from selected saved position to current position
    const currentDistanceElem = document.getElementById('current-distance');
    if (currentDistanceElem && selected != null) {
      currentDistanceElem.innerText = formatDistance(
        calculateDistance(selected.latitude, selected.longitude, currentLat, currentLon)
      );
    }
    return;
  }
};

  const formatDistance = (distance: number) => {
    // convert m to nice format (cm, m, km)
    var output;
    if (distance < 1) {
      output = distance * 100 + " cm";
    }
    else if (distance < 1000) {
      output = distance + " m";
    }
    else {
      output = distance / 1000 + " km";
    }
    return output;
  }

  // function updates pins
  const updatePin = async (index: number, show: boolean) => {
    logToRosout("updatePin: starting!");

    if (savedPositions[index])
      savedPositions[index].pinned = show;

    if (!context || !context.advertise || !context.publish) {
      // throw error?
      logToRosout("updatePin: could not publish message!");
      return;
    }

    // logToRosout("updating pin " + index + " to " + show);

    context.advertise(`/navigation_pin_${index}`, "sensor_msgs/msg/NavSatFix");

    context.publish(`/navigation_pin_${index}`, {
      "header": {
        // "stamp": {
        //   "sec": Math.floor(Date.now() / 1000),
        //   "nanosec": (Date.now() % 1000) * 1e6,
        // },
        // "frame_id": `pin_${index}`
        "stamp": {
          "sec": 0,
          "nanosec": 0
        },
        "frame_id": ""
      },
      "status": {
        "status": 0,
        "service": 0
      },
      "latitude": show ? savedPositions[index]?.latitude : 0,
      "longitude": show ? savedPositions[index]?.longitude : 0,
      "altitude": 0,
      "position_covariance": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "position_covariance_type": 0
    });

    logToRosout("updatePin: published message!");
  }
  

  const logToRosout = (message: string, level: number = 1) => {
    if (!context || !context.publish || !context.advertise) {
      console.error("Context or publish function is not available.");
      return;
    }
  
    context.advertise("/rosout", "rcl_interfaces/msg/Log");
  
    context.publish("/rosout", {
      stamp: {
        sec: Math.floor(Date.now() / 1000),
        nanosec: (Date.now() % 1000) * 1e6,
      },
      level, // Log level
      name: "foxglove_panel",
      msg: message,
      file: "GPSTrackerPanel.tsx",
      function: "logToRosout",
      line: 1,
    });
  };

  useEffect(() => {
    context.saveState(config);
    const navigationTopicOptions = (navigationTopics ?? []).map((topic) => ({ value: topic.name, label: topic.name }));
    
    context.updatePanelSettingsEditor({
      actionHandler,
      nodes: {
        general: {
          label: "General",
          icon: "Cube",
          fields: {
            navigationTopic: {
              label: "Navigation Topic",
              input: "select",
              options: navigationTopicOptions,
              value: config.navigationTopic,
            },

          }
        }
      }
    });
  }, [context, actionHandler, config, topics]);


  // subscribe to wanted topics
  useEffect(() => {
    context.saveState({ topic: config });
    let topicsList = [];

    if (config.navigationTopic) {
      topicsList.push({ topic: config.navigationTopic });
    }
    context.subscribe(topicsList);
  }, [context, config]);

  // save saved positions to context between refreshes
  useEffect(() => {
    context.saveState({ savedPositions });
  }, [context, savedPositions]);
  
  // main layout effect
  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setMessages(renderState.currentFrame);
      setTopics(renderState.topics);
    };

    context.watch("topics");
    context.watch("currentFrame");
  }, [context]);

  //read all incoming messages
  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === config.navigationTopic) {

          setLastMessage(message); // update Current Position

        }
      }
    }
  }, [messages]);

  // also updateDistances when receiving a message
  useEffect(() => {
    updateDistances();
  }, [lastMessage]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);


  const updateSavedPosition = async (property: keyof typeof savedPositions[0], index: number, value: string | number) => {
    // logToRosout("Updating index " + index + " to " + value);
    if (property == "name" && value == "DELETE") {

      // VISUALLY UNCHECK EVERYTHING
      var allPins = document.getElementsByName("pin");
      var savedStates: boolean[] = [];
      allPins.forEach((pin, i) => {
        var savedState = savedPositions[i]?.pinned ?? false;

        (pin as HTMLInputElement).checked = savedState;
        updatePin(i, false); // unpin  

        if (i != index) {savedStates.push(savedState);}
      });

      // remove deleted one
      setSavedPositions(prev => prev.filter((_, i) => i !== index));
      
      logToRosout("Adding them back: with " + savedStates.length);
      // visually add them back
      savedStates.forEach((state, i) => {
        (allPins[i] as HTMLInputElement).checked = state;
        if (state) updatePin(i, state);
      });

      return;
    }

    setSavedPositions(prev =>
      prev.map((pos, i) =>
        i === index ? { ...pos, [property]: value } : pos
      )
    );
  };


  const toggleAllPins = async () => {
    var allPins = document.getElementsByName("pin");
    if (allPins.length <= 0) return;
    var state = !(allPins[0] as HTMLInputElement).checked;
    allPins.forEach((pin, i) => {
      (pin as HTMLInputElement).checked = state;
      // (pin as HTMLInputElement).dispatchEvent(new Event("onchange"));
      updatePin(i, state);
    });
  };
  
  const deleteAllPins = async () => {
    savedPositions.forEach((position, index) => {
      updatePin(index, false);
    })
    setSavedPositions([]);
  }

  function getSelectedIndex() {
    const radioButtons = document.querySelectorAll('input[name="compare"]');
    const selectedIndex = Array.from(radioButtons).findIndex(radio => (radio as HTMLInputElement).checked);

    logToRosout("SELECTED RADIO INDEX: " + selectedIndex);
}


  return (
    <div style={{ padding: "1rem" }}>
      <style>
        {`
          input[type=number]::-webkit-outer-spin-button,
          input[type=number]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          input[type=number] {
            -moz-appearance: textfield;
          }
          .gridItemStyle {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            width: 100%;
          }
          .gridTextboxStyle {
            background: none;
            color: white;
            border: none;
            text-overflow: ellipsis;
            overflow: hidden;
            white-space: nowrap;
            width: 100%;
          }
          .gridHeaderStyle {
            border-bottom: 1px solid;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            width: 100%;
          }


          input[type='checkbox'] {
            -moz-appearance: none;
            -webkit-appearance: none;
            appearance: none;
            vertical-align: middle;
            outline: none;
            font-size: inherit;
            cursor: pointer;
            width: 100%;
            height: 100%;
            background: #202020;
            border-radius: 0.25em;
            border: 0.125em solid #555;
            position: relative;
            margin: 0;
          }

          input[type='checkbox']:checked {
            background: #FFFFFF;
            box-shadow: 0px 0px 2px 3px rgba(0,0,0,0.75) inset;
          }

          input[type='radio'] {
            -moz-appearance: none;
            -webkit-appearance: none;
            appearance: none;
            vertical-align: middle;
            outline: none;
            font-size: inherit;
            cursor: pointer;
            /* max-width: 100%; */
            height: 100%;
            background: #202020;
            /* border-radius: 0.25em; */
            border-radius: 50%;
            border: 0.125em solid #555;
            position: relative;
            margin: 0;
            aspect-ratio: 1;
          }

          input[type='radio']:checked {
            background: #FFFFFF;
            box-shadow: 0px 0px 2px 3px rgba(0,0,0,0.75) inset;
          }
        `}
      </style>
      <h1>GPS Tracker</h1>
      <h3>Current Position</h3>
      <div>
        {lastMessage ? (
          
          <div style={{ display: "grid", gridTemplateColumns: "3fr 5fr 5fr 3fr 0.6fr 1.4fr", rowGap: "0.2rem", overflow: "hidden", border: "1px solid"}}>
            <b className="gridHeaderStyle">Name</b>
            <b className="gridHeaderStyle">Latitude</b>
            <b className="gridHeaderStyle">Longitude</b>
            <b className="gridHeaderStyle">Timestamp</b>
            <b className="gridHeaderStyle">Compare</b>
            <b className="gridHeaderStyle">Distance</b>
            
            <input
              type="text"
              id="current-tag-name"
              defaultValue="Current"
              className="gridTextboxStyle"
            />
            <div className="gridItemStyle">{(lastMessage.message as any).latitude}</div>
            <div className="gridItemStyle">{(lastMessage.message as any).longitude}</div>
            {/* <div>{new Date((lastMessage.message as any).header.stamp.nsec??0).toUTCString()}</div> */}
            <div className="gridItemStyle">{new Date((lastMessage.message as any).header.stamp.sec * 1000 + (lastMessage.message as any).header.stamp.nsec / 1e6).toUTCString()}</div>
            <div className="gridItemStyle">
              <input type="radio" name="compare" onClick={updateDistances}/>
            </div>
            <div className="gridItemStyle" id="current-distance">0 m</div>

          </div>
        ) : (
          <p>No New Data</p>
        )}
      </div>
      <button onClick={saveCurrentPosition} style={{ marginTop: "1rem" }}>Save Current Position</button>
      <button onClick={() => {(document.getElementById("CustomPositionDialog") as HTMLDialogElement)?.showModal();}}>Custom Position Dialog</button>
      
      {/* <h3>Input Custom Position</h3> */}
      <dialog id="CustomPositionDialog">
        <form method="dialog">
          <p>
            <label>Name:</label><input type="text" defaultValue="New" id="customNameInput" />
            <br/>
            <label>Latitude:</label><input type="number" id="customLatitudeInput"/>
            <br/>
            <label>Longitude:</label><input type="number" id="customLongitudeInput" />
          </p>
          <div>
            <button type="reset" onClick={() => {
              (document.getElementById("CustomPositionDialog") as HTMLDialogElement)?.close();
            }}>Cancel</button>
            <button type="reset" onClick={() => {
              const name = (document.getElementById("customNameInput") as HTMLInputElement).value ?? "-";
              const latitude = Number.parseFloat((document.getElementById("customLatitudeInput") as HTMLInputElement).value) ?? 0;
              const longitude = Number.parseFloat((document.getElementById("customLongitudeInput") as HTMLInputElement).value) ?? 0;
              saveCustomPosition(name, latitude, longitude);
              (document.getElementById("CustomPositionDialog") as HTMLDialogElement)?.close();
            }}>Confirm</button>
          </div>
        </form>
      </dialog>
      

      <h3>Saved Positions</h3>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 5fr 5fr 3fr 0.6fr 1.4fr 1fr", rowGap: "0.2rem", overflow: "hidden", border: "1px solid"}}>
        <b className="gridHeaderStyle">Name</b>
        <b className="gridHeaderStyle">Latitude</b>
        <b className="gridHeaderStyle">Longitude</b>
        <b className="gridHeaderStyle">Timestamp</b>
        <b className="gridHeaderStyle">Compare</b>
        <b className="gridHeaderStyle">Distance</b>
        <b className="gridHeaderStyle">Pin</b>
        {savedPositions.map((position, index) => (
          <>
            <input
              type="text"
              value={position.name.toString()}
              className="gridTextboxStyle"
              onChange={e => {
                updateSavedPosition("name", index, e.target.value);
                if (e.target.value == "DELETE") {e.target.blur();}
              }}
              onKeyDown={e => {if (e.key === "Enter") {(e.target as HTMLInputElement).blur();}}}

            />
            <input
              type="number"
              value={position.latitude}
              className="gridTextboxStyle"
              onChange={e => updateSavedPosition("latitude", index, e.target.value)}
              onKeyDown={e => {if (e.key === "Enter") {(e.target as HTMLInputElement).blur();}}}
            />
            <input
              type="number"
              value={position.longitude}
              className="gridTextboxStyle"
              onChange={e => updateSavedPosition("longitude", index, e.target.value)}
              onKeyDown={e => {if (e.key === "Enter") {(e.target as HTMLInputElement).blur();}}}
            />
            <input
              type="text"
              defaultValue={position.timestamp}
              className="gridTextboxStyle"
            />
            <div key={`compare-${index}`}>
              {/* <input type="radio" name="compare" value={index} /> */}
              <input type="radio" name="compare" onClick={() => updateDistances()}/>
            </div>
            <div style={{whiteSpace: "nowrap"}} key={`distance-${index}`}>{formatDistance(position.distance)}</div>
            <div key={`pinbox-${index}`}>
              <input type="checkbox" name="pin" defaultChecked={position.pinned} onChange={(e) => updatePin(index, e.target.checked)}/>
            </div>
          </>
        ))}
      </div>
      
      <button onClick={toggleAllPins} style={{ marginTop: "1rem" }}>Toggle All Pins</button>
      <button onClick={deleteAllPins} style={{ marginTop: "1rem" }}>Delete All Pins</button>
      <button onClick={getSelectedIndex} style={{ marginTop: "1rem" }}>Debug</button>
      
    </div>
  );
}

export function initGPSTrackerPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<GPSTrackerPanel context={context} />);

  // Return a function to run when the panel is removed
  return () => {
    root.unmount();
  };
}
