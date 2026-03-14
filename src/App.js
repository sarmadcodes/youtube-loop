import { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./App.css";

function extractVideoId(raw) {
  const url = raw.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch { return null; }
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function SortableQueueItem({ item, index, isActive, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.uid });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`queue-item ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""}`}
    >
      <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
      <span className="q-index">{String(index + 1).padStart(2, "0")}</span>
      <span className="q-id">
        {item.title || item.id}
        {!item.title && <span className="q-loading">…</span>}
      </span>
      <span className="q-status">{isActive ? "▶" : ""}</span>
      <button className="btn-remove" onClick={() => onRemove(item.uid)}>✕</button>
    </div>
  );
}

export default function App() {
  const [queue, setQueue] = useState(() => {
    try {
      const saved = localStorage.getItem("yt-loop-queue");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [loopEnabled, setLoopEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("yt-loop-enabled");
      return saved === null ? true : JSON.parse(saved);
    } catch { return true; }
  });
  const [currentUid, setCurrentUid] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [error, setError] = useState("");
  const playerRef = useRef(null);
  const playerDivRef = useRef(null);
  const apiReadyRef = useRef(false);
  const queueRef = useRef(queue);
  const currentUidRef = useRef(currentUid);
  const loopRef = useRef(loopEnabled);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentUidRef.current = currentUid; }, [currentUid]);
  useEffect(() => { loopRef.current = loopEnabled; }, [loopEnabled]);

  // fetch titles for any queue items missing one
  useEffect(() => {
    queue.forEach((item) => {
      if (!item.title) {
        fetchTitle(item.id).then((title) => {
          if (title) {
            setQueue((prev) =>
              prev.map((i) => i.uid === item.uid ? { ...i, title } : i)
            );
          }
        });
      }
    });
  }, [queue.length]); // eslint-disable-line

  // persist queue
  useEffect(() => {
    try { localStorage.setItem("yt-loop-queue", JSON.stringify(queue)); } catch {}
  }, [queue]);

  // persist loop toggle
  useEffect(() => {
    try { localStorage.setItem("yt-loop-enabled", JSON.stringify(loopEnabled)); } catch {}
  }, [loopEnabled]);

  useEffect(() => {
    if (window.YT && window.YT.Player) { apiReadyRef.current = true; return; }
    window.onYouTubeIframeAPIReady = () => { apiReadyRef.current = true; };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }, []);

  const playByUid = useCallback((uid) => {
    const q = queueRef.current;
    const item = q.find((i) => i.uid === uid);
    if (!item) return;
    setCurrentUid(uid);
    setIsPlaying(true);

    if (playerRef.current) {
      playerRef.current.loadVideoById(item.id);
      return;
    }
    if (!apiReadyRef.current) return;

    playerRef.current = new window.YT.Player(playerDivRef.current, {
      videoId: item.id,
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
      events: {
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.ENDED) {
            const q2 = queueRef.current;
            const cur = currentUidRef.current;
            const idx = q2.findIndex((i) => i.uid === cur);
            if (q2.length === 0) return;
            const isLast = idx === q2.length - 1;
            if (isLast && !loopRef.current) return;
            const nextIdx = (idx + 1) % q2.length;
            playByUid(q2[nextIdx].uid);
          }
        },
      },
    });
  }, []);

  async function addLink() {
    const val = inputVal.trim();
    if (!val) return;
    const id = extractVideoId(val);
    if (!id) { setError("invalid youtube url"); return; }
    if (queue.find((q) => q.id === id)) { setError("already in queue"); return; }
    setError("");
    const newItem = { uid: uid(), id, url: val, title: null };
    setQueue((prev) => [...prev, newItem]);
    setInputVal("");
    // fetch title immediately
    const title = await fetchTitle(id);
    if (title) {
      setQueue((prev) => prev.map((i) => i.uid === newItem.uid ? { ...i, title } : i));
    }
  }

  function removeItem(targetUid) {
    setQueue((prev) => {
      const next = prev.filter((i) => i.uid !== targetUid);
      if (targetUid === currentUidRef.current) {
        if (next.length === 0) {
          setCurrentUid(null);
          setIsPlaying(false);
          if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
        } else {
          const oldIdx = prev.findIndex((i) => i.uid === targetUid);
          const newIdx = Math.min(oldIdx, next.length - 1);
          setTimeout(() => playByUid(next[newIdx].uid), 0);
        }
      }
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setQueue((prev) => {
      const oldIdx = prev.findIndex((i) => i.uid === active.id);
      const newIdx = prev.findIndex((i) => i.uid === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function skip(dir) {
    if (queue.length === 0) return;
    const idx = queue.findIndex((i) => i.uid === currentUid);
    const next = (idx + dir + queue.length) % queue.length;
    playByUid(queue[next].uid);
  }

  function clearAll() {
    setQueue([]);
    setCurrentUid(null);
    setIsPlaying(false);
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
  }

  return (
    <div className="app">
      <header>
        <span className="logo">loop</span>
        <span className="tagline">youtube queue player</span>
      </header>

      <main>
        <div className="input-section">
          <div className="input-row">
            <input
              value={inputVal}
              onChange={(e) => { setInputVal(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && addLink()}
              placeholder="paste youtube link…"
              spellCheck={false}
            />
            <button
              className={`btn-loop-toggle ${loopEnabled ? "on" : "off"}`}
              onClick={() => setLoopEnabled((v) => !v)}
            >
              ↻ {loopEnabled ? "loop on" : "loop off"}
            </button>
            <button className="btn-add" onClick={addLink}>+</button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        <div className="player-wrap">
          {!isPlaying && (
            <div className="player-placeholder">
              <span>no video loaded</span>
            </div>
          )}
          <div ref={playerDivRef} id="yt-player" />
        </div>

        <div className="controls">
          <button className="btn-ctrl" onClick={() => skip(-1)} disabled={queue.length < 2}>prev</button>
          {!isPlaying ? (
            <button className="btn-ctrl primary" onClick={() => queue.length > 0 && playByUid(queue[0].uid)} disabled={queue.length === 0}>play</button>
          ) : (
            <button className="btn-ctrl" onClick={() => skip(1)} disabled={queue.length < 2}>next</button>
          )}
          <div className="spacer" />
        </div>

        <div className="queue-section">
          <div className="queue-header">
            <span className="queue-label">{queue.length} in queue</span>
            {queue.length > 0 && <button className="btn-clear" onClick={clearAll}>clear all</button>}
          </div>

          {queue.length === 0 ? (
            <p className="queue-empty">empty — paste links above</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={queue.map((i) => i.uid)} strategy={verticalListSortingStrategy}>
                <div className="queue-list">
                  {queue.map((item, i) => (
                    <SortableQueueItem
                      key={item.uid}
                      item={item}
                      index={i}
                      isActive={item.uid === currentUid}
                      onRemove={removeItem}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </main>
    </div>
  );
}