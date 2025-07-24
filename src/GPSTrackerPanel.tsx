import { Immutable, MessageEvent, PanelExtensionContext, SettingsTreeAction, Topic } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
// import { property, set } from "lodash";
import { set } from "lodash";

type Config = {
  navigationTopic?: string
}

function GPSTrackerPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [lastMessage, setLastMessage] = useState<undefined | MessageEvent>(); // state for the last message ("Current Position")
  // const [savedPositions, setSavedPositions] = useState<Array<{ name: String; latitude: number; longitude: number; timestamp: string, distance: number }>>([]); // state for saved positions
  const [savedPositions, setSavedPositions] = useState<Array<{ name: string; latitude: number; longitude: number; timestamp: string; distance: number }>>(() => {
    const initialState = context.initialState as { savedPositions?: Array<{ name: string; latitude: number; longitude: number; timestamp: string; distance: number }> };
    return initialState?.savedPositions ?? []; // Restore savedPositions or initialize as an empty array
  });
  // const [customLatitude, setCustomLatitude] = useState<string>(""); // state for manual latitude input
  // const [customLongitude, setCustomLongitude] = useState<string>(""); // state for manual longitude input
  // const [customName] = useState<string>("");

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

      setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance }]);
    }
    else {
      logToRosout("FAILED");
    }
  };

  // Function to save custom GPS coordinates
  // const saveCustomPosition = () => {
  //   const nameInput = document.getElementById("custom-tag-name") as HTMLInputElement;
  //   const name = nameInput ? nameInput.value : "-";

  //   // const latitude = parseFloat(customLatitude);
  //   // const longitude = parseFloat(customLongitude);
  //   const latitudeInput = document.getElementById("custom-tag-latitude") as HTMLInputElement;
  //   const latitude = parseFloat(latitudeInput ? latitudeInput.value : "-1");
  //   const longitudeInput = document.getElementById("custom-tag-longitude") as HTMLInputElement;
  //   const longitude = parseFloat(longitudeInput ? longitudeInput.value : "-1");

  //   const distance = -1;

  //   const timestamp = new Date().toISOString(); // Use current timestamp for custom positions
  //   setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance }]);
  //   // setCustomLatitude(""); // Clear input fields
  //   // setCustomLongitude("");
  // };

  const saveCustomPosition = (name: string, latitude: number, longitude: number) => {
    const timestamp = new Date().toISOString();
    const distance = -1;

    setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance }]);
  }


  // function that updates comparing distances
  const updateDistances = async (index: number) => {
    const updatedPositions = await new Promise<Array<typeof savedPositions[0]>>((resolve) => {
      const selectedPosition = savedPositions[index];
      if (!selectedPosition) return;
      const positions = savedPositions.map((position, i) => {
        if (i === index) {
          return { ...position, distance: 0 };
        } else {
          const R = 6371000;
          const dLat = ((position.latitude - selectedPosition.latitude) * Math.PI) / 180;
          const dLon = ((position.longitude - selectedPosition.longitude) * Math.PI) / 180;
          const lat1 = (selectedPosition.latitude * Math.PI) / 180;
          const lat2 = (position.latitude * Math.PI) / 180;
  
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          
          const distance = Math.round((R * c) * 10) / 10; // value in meters

          // convert distance to nice numbers (m, km, ..? lightyears? actually idk OH just put it in the output)
  
          return { ...position, distance };
        }
      });
      resolve(positions);
    });
  
    setSavedPositions(updatedPositions);
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

  // testing function delete me
  const myTestingFunction = () => {
    if (!context || !context.advertise || !context.publish) {
      // throw error?
      return;
    }
    
    for (var i = 0; i < 3; i++) {
      context.advertise(`/navigation_pin_${i}`, "sensor_msgs/msg/NavSatFix");
      
      context.publish(`/navigation_pin_${i}`, {
        "header": {
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
        "latitude": 0,
        "longitude": 0,
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
    }
  }

  const myTestingFunction2 = () => {
    if (!context || context == null) {
      // setFeedback('Error: Service call function not available. Is your ROS 2 connection active?');
      // Revert UI state if service call not possible
      // setCurrentState(!command_bool); 
      return;
    }
    
    if (context.advertise) {
      context.advertise("/navigation3", "sensor_msgs/msg/NavSatFix");
    }
    if (context.publish) {
      context.publish("/navigation3", {
        "header": {
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
        "latitude": 0,
        "longitude": 0,
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
      })
    }
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
      level, // Log level (1 = DEBUG, 2 = INFO, etc.)
      name: "foxglove_panel",
      msg: message,
      file: "GPSTrackerPanel.tsx",
      function: "logToRosout",
      line: 1, // You can set this dynamically if needed
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
    // context.subscribe([{ topic: "/some/topic" }]);
  }, [context]);

  //read all incoming messages
  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === config.navigationTopic) {
          // LOG MESSAGE
          console.log("ReCEIVED MESSAGE");

          setLastMessage(message); // set text under "Current Position"
        }
      }
    }
  }, [messages]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);


  const updateSavedPosition = async (property: keyof typeof savedPositions[0], index: number, value: string | number) => {
    // logToRosout("Updating index " + index + " to " + value);
    if (property == "name" && value == "DELETE") {
      setSavedPositions(prev => prev.filter((_, i) => i !== index));
      return;
    }
    setSavedPositions(prev =>
      prev.map((pos, i) =>
        i === index ? { ...pos, [property]: value } : pos
      )
    );
  };
  

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
            white-space: nowrap;
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
            white-space: nowrap;
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
              <input type="radio" name="compare" />
            </div>
            <div className="gridItemStyle">0 m</div>

          </div>
        ) : (
          <p>No New Data</p>
        )}
      </div>
      <button onClick={saveCurrentPosition} style={{ marginTop: "1rem" }}>Save Current Position</button>
      
      <h3>Input Custom Position</h3>
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
      {/* <button onClick={saveCustomPosition} style={{ marginTop: "1rem" }}>Save Custom Position</button> */}
      <button onClick={() => {(document.getElementById("CustomPositionDialog") as HTMLDialogElement)?.showModal();}} style={{ marginTop: "1rem" }}>Open dialog</button>
      
      
      <div>
        <button onClick={myTestingFunction} style={{ marginTop: "1rem", display: "none" }}>TEST 1</button>
        <button onClick={myTestingFunction2} style={{ marginTop: "1rem", display: "none" }}>TEST 2</button>
      </div>

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
              <input type="radio" name="compare" onClick={() => updateDistances(index)}/>
            </div>
            <div className="gridItemStyle" key={`distance-${index}`}>{formatDistance(position.distance)}</div>
            <div key={`pinbox-${index}`}>
              <input type="checkbox" name="pin" onChange={(e) => updatePin(index, e.target.checked)}/>
            </div>
          </>
        ))}
      </div>
      
      <button onClick={saveCurrentPosition} style={{ marginTop: "1rem" }}>Toggle All Pins</button>
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
