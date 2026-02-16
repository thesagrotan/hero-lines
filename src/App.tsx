import { useRef, useEffect } from 'react'
import { useSceneStore } from './store/sceneStore'
import { useRenderer } from './renderer/useRenderer'
import { SceneControls } from './components/SceneControls'
import { ObjectControls } from './components/ObjectControls'
import { DeviceBar } from './components/DeviceBar'
import { TimelinePanel } from './components/TimelinePanel'
import { ObjectList } from './components/ObjectList'
import { FPSCounter } from './components/FPSCounter'

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const timelineRef = useRef<any>(null);

    // Use store state
    const {
        scene, setScene
    } = useSceneStore();

    // Initialize renderer
    useRenderer(canvasRef, timelineRef);

    // Zoom via wheel
    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            setScene({ zoom: Math.max(0.1, Math.min(2.0, scene.zoom - e.deltaY * 0.001)) });
        }
        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => { canvas.removeEventListener('wheel', wheel); }
    }, [scene.zoom, setScene])

    return (
        <div className="app-container">
            <canvas ref={canvasRef} />
            <FPSCounter />
            <SceneControls />
            <ObjectControls />
            <DeviceBar />
            <ObjectList />
            <TimelinePanel />
        </div>
    )
}
