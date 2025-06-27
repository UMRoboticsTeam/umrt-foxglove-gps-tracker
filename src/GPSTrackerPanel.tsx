import { Immutable, MessageEvent, PanelExtensionContext, SettingsTreeAction, Topic } from "@foxglove/extension";
import { ReactElement, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { set } from "lodash";

type Config = {
  navigationTopic?: string
}

function ExamplePanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [lastMessage, setLastMessage] = useState<undefined | MessageEvent>(); // state for the last message ("Current Position")
  const [savedPositions, setSavedPositions] = useState<Array<{ latitude: number; longitude: number; timestamp: string }>>([]); // state for saved positions
  const [customLatitude, setCustomLatitude] = useState<string>(""); // state for manual latitude input
  const [customLongitude, setCustomLongitude] = useState<string>(""); // state for manual longitude input

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
      const latitude = (lastMessage.message as any).latitude;
      const longitude = (lastMessage.message as any).longitude;
      const timestamp = new Date((lastMessage.message as any).header.stamp.sec * 1000 + (lastMessage.message as any).header.stamp.nsec / 1e6).toISOString();
      setSavedPositions((prev) => [...prev, { latitude, longitude, timestamp }]);
    }
  };

  // Function to save custom GPS coordinates
  const saveCustomPosition = () => {
    if (customLatitude && customLongitude) {
      const latitude = parseFloat(customLatitude);
      const longitude = parseFloat(customLongitude);
      const timestamp = new Date().toISOString(); // Use current timestamp for custom positions
      setSavedPositions((prev) => [...prev, { latitude, longitude, timestamp }]);
      setCustomLatitude(""); // Clear input fields
      setCustomLongitude("");
    }
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

  return (
    <div style={{ padding: "1rem" }}>
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
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", rowGap: "0.2rem" }}>
            <b style={{ borderBottom: "1px solid" }}>Latitude</b>
            <b style={{ borderBottom: "1px solid" }}>Longitude</b>
            <b style={{ borderBottom: "1px solid" }}>Timestamp</b>
            <b style={{ borderBottom: "1px solid" }}>Compare</b>
            <b style={{ borderBottom: "1px solid" }}>Distance</b>
            

            {/* idk if this is the proper way to access ROS message data */}
            <div>{(lastMessage.message as any).latitude}</div>
            <div>{(lastMessage.message as any).longitude}</div>
            {/* <div>{new Date((lastMessage.message as any).header.stamp.nsec??0).toUTCString()}</div> */}
            <div>{new Date((lastMessage.message as any).header.stamp.sec * 1000 + (lastMessage.message as any).header.stamp.nsec / 1e6).toUTCString()}</div>
            <input type="radio" name="compare" />

          </div>
        ) : (
          <p>No New Data</p>
        )}
      </div>
      <button onClick={saveCurrentPosition} style={{ marginTop: "1rem" }}>Save Current Position</button>
      


      <h3>Input Custom Position</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: "0.5rem", marginTop: "1rem" }}>
        <label>
          Latitude:
          <input
            type="text"
            value={customLatitude}
            onChange={(e) => setCustomLatitude(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
        <label>
          Longitude:
          <input
            type="text"
            value={customLongitude}
            onChange={(e) => setCustomLongitude(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
      </div>
      <button onClick={saveCustomPosition} style={{ marginTop: "1rem" }}>Save Custom Position</button>

      

      <h3>Saved Positions</h3>
      <div style={{ display: "grid", gridTemplateColumns: "5fr 5fr 5fr 1fr 1fr", rowGap: "0.2rem", overflow: "hidden", border: "1px solid"}}>
        <b style={{ borderBottom: "1px solid" }}>Latitude</b>
        <b style={{ borderBottom: "1px solid" }}>Longitude</b>
        <b style={{ borderBottom: "1px solid" }}>Timestamp</b>
        <b style={{ borderBottom: "1px solid" }}>Compare</b>
        <b style={{ borderBottom: "1px solid" }}>Distance</b>
        {savedPositions.map((position, index) => (
          <>
            <div key={`latitude-${index}`}>{position.latitude}</div>
            <div key={`longitude-${index}`}>{position.longitude}</div>
            <div key={`timestamp-${index}`}>{position.timestamp}</div>
            <div key={`compare-${index}`}>
              <input type="radio" name="compare" value={index} />
            </div>
            <div key={`distance-${index}`}>-</div>
          </>
        ))}
      </div>

    </div>
  );
}

export function initGPSTrackerPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<ExamplePanel context={context} />);

  // Return a function to run when the panel is removed
  return () => {
    root.unmount();
  };
}
