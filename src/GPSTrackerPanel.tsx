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
  const saveCustomPosition = () => {
    const nameInput = document.getElementById("custom-tag-name") as HTMLInputElement;
    const name = nameInput ? nameInput.value : "-";

    // const latitude = parseFloat(customLatitude);
    // const longitude = parseFloat(customLongitude);
    const latitudeInput = document.getElementById("custom-tag-latitude") as HTMLInputElement;
    const latitude = parseFloat(latitudeInput ? latitudeInput.value : "-1");
    const longitudeInput = document.getElementById("custom-tag-longitude") as HTMLInputElement;
    const longitude = parseFloat(longitudeInput ? longitudeInput.value : "-1");

    const distance = -1;

    const timestamp = new Date().toISOString(); // Use current timestamp for custom positions
    setSavedPositions((prev) => [...prev, { name, latitude, longitude, timestamp, distance }]);
    // setCustomLatitude(""); // Clear input fields
    // setCustomLongitude("");
  };


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
          const distance = Math.round((R * c) * 10) / 10;
  
          return { ...position, distance };
        }
      });
      resolve(positions);
    });
  
    setSavedPositions(updatedPositions);
  };

  // function updates pins
  const updatePin = async (index: number, show: boolean) => {
    if (!context || !context.advertise || !context.publish) {
      // throw error?
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



// ============================= CSS STYLES =============================
  const gridItemStyle = { 
    textOverflow: "ellipsis", 
    overflow: "hidden", 
    whiteSpace: "nowrap" 
  };
  const gridTextboxStyle = { 
    background: "none", 
    color: "white", 
    border: "none",
    textOverflow: "ellipsis", 
    overflow: "hidden",
    whiteSpace: "nowrap",
    width: "100%",
    
  };

  const updateSavedPosition = (property: keyof typeof savedPositions[0], index: number, value: string | number) => {
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
        `}
      </style>
      <h2>GPS Tracker</h2>
      {/* <p>
        Check the{" "}
        <a href="https://foxglove.dev/docs/studio/extensions/getting-started">documentation</a> for
        more details on building extension panels for Foxglove Studio.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: "0.2rem" }}>
        <b style={{ borderBottom: "1px solid" }}>Topic</b>
        <b style={{ borderBottom: "1px solid" }}>Schema name</b>
        {(topics ?? []).map((topic) => (
          <>
            <div key={topic.name}>{topic.name}</div>
            <div key={topic.schemaName}>{topic.schemaName}</div>
          </>
        ))}
      </div>
      <div>{messages?.length}</div> */}


      <h3>Current Position</h3>
      <div>
        {lastMessage ? (
          
          <div style={{ display: "grid", gridTemplateColumns: "5fr 5fr 5fr 5fr 1fr 1fr", rowGap: "0.2rem", overflow: "hidden", border: "1px solid"}}>
            <b style={{ borderBottom: "1px solid" }}>Name</b>
            <b style={{ borderBottom: "1px solid" }}>Latitude</b>
            <b style={{ borderBottom: "1px solid" }}>Longitude</b>
            <b style={{ borderBottom: "1px solid" }}>Timestamp</b>
            <b style={{ borderBottom: "1px solid" }}>Compare</b>
            <b style={{ borderBottom: "1px solid" }}>Distance</b>
            

            {/* idk if this is the proper way to access ROS message data */}
            <input type="text" id="current-tag-name" defaultValue="Current" style={{background: "none", color: "white", border: "none"}}/>
            <div>{(lastMessage.message as any).latitude}</div>
            <div>{(lastMessage.message as any).longitude}</div>
            {/* <div>{new Date((lastMessage.message as any).header.stamp.nsec??0).toUTCString()}</div> */}
            <div>{new Date((lastMessage.message as any).header.stamp.sec * 1000 + (lastMessage.message as any).header.stamp.nsec / 1e6).toUTCString()}</div>
            <input type="radio" name="compare" />
            <div>-</div>

          </div>
        ) : (
          <p>No New Data</p>
        )}
      </div>
      <button onClick={saveCurrentPosition} style={{ marginTop: "1rem" }}>Save Current Position</button>
      

      
      <h3>Input Custom Position</h3>
      <dialog id="favDialog">
        <form method="dialog">
          <p>
            <label>Favorite animal:</label>
            <select id="favAnimal" name="favAnimal">
              <option></option>
              <option>Brine shrimp</option>
              <option>Red panda</option>
              <option>Spider monkey</option>
            </select>
          </p>
          <div>
            <button id="cancel" type="reset">Cancel</button>
            <button type="submit">Confirm</button>
          </div>
        </form>
      </dialog>
      <button onClick={saveCustomPosition} style={{ marginTop: "1rem" }}>Save Custom Position</button>
      <button onClick={() => {(document.getElementById("favDialog") as HTMLDialogElement)?.showModal();}} style={{ marginTop: "1rem" }}>Open dialog</button>
      
      
      <div>
        <button onClick={myTestingFunction} style={{ marginTop: "1rem", display: "none" }}>TEST 1</button>
        <button onClick={myTestingFunction2} style={{ marginTop: "1rem", display: "none" }}>TEST 2</button>
      </div>

      <h3>Saved Positions</h3>
      <div style={{ display: "grid", gridTemplateColumns: "5fr 5fr 5fr 5fr 1fr 1fr 1fr", rowGap: "0.2rem", overflow: "hidden", border: "1px solid"}}>
      <b style={{ borderBottom: "1px solid" }}>Name</b>
        <b style={{ borderBottom: "1px solid" }}>Latitude</b>
        <b style={{ borderBottom: "1px solid" }}>Longitude</b>
        <b style={{ borderBottom: "1px solid" }}>Timestamp</b>
        <b style={{ borderBottom: "1px solid" }}>Compare</b>
        <b style={{ borderBottom: "1px solid" }}>Distance</b>
        <b style={{ borderBottom: "1px solid" }}>Pin</b>
        {savedPositions.map((position, index) => (
          <>
            {/* <div key={`name-${index}`}>{position.name}</div> */}
            {/* <input type="text">{position.name}</input> */}
            <input
              type="text"
              defaultValue={position.name.toString()} // Set the initial value to position.name
              style={gridTextboxStyle}
              onChange={e => updateSavedPosition("name", index, e.target.value)}

            />
            {/* <div style={gridItemStyle} key={`latitude-${index}`}>{position.latitude}</div> */}
            <input
              type="number"
              defaultValue={position.latitude}
              style={gridTextboxStyle}
              onChange={e => updateSavedPosition("latitude", index, e.target.value)}
            />
            {/* <div style={gridItemStyle} key={`longitude-${index}`}>{position.longitude}</div> */}
            <input
              type="number"
              defaultValue={position.longitude}
              style={gridTextboxStyle}
              onChange={e => updateSavedPosition("longitude", index, e.target.value)}
            />
            {/* <div style={gridItemStyle} key={`timestamp-${index}`}>{position.timestamp}</div> */}
            <input
              type="text"
              defaultValue={position.timestamp}
              style={gridTextboxStyle}
            />
            <div key={`compare-${index}`}>
              {/* <input type="radio" name="compare" value={index} /> */}
              <input type="radio" name="compare" onClick={() => updateDistances(index)}/>
            </div>
            <div style={gridItemStyle} key={`distance-${index}`}>{position.distance}</div>
            <div key={`pinbox-${index}`}>
              <input type="checkbox" name="pin" onChange={(e) => updatePin(index, e.target.checked)}/>
            </div>
          </>
        ))}
      </div>

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
