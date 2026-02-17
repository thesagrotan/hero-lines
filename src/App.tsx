import { useRef } from 'react'
import { SceneControls } from './components/SceneControls'
import { ObjectControls } from './components/ObjectControls'
import { DeviceBar } from './components/DeviceBar'
import { TimelinePanel } from './components/TimelinePanel'
import { ObjectList } from './components/ObjectList'
import { FPSCounter } from './components/FPSCounter'
import { RendererView } from './components/RendererView'
import { useAutoCycle } from './hooks/useAutoCycle'

export default function App() {
    useAutoCycle();
    const timelineRef = useRef<any>(null);

    return (
        <div className="app-container">
            <RendererView timelineRef={timelineRef} />
            <FPSCounter />
            <SceneControls />
            <ObjectControls />
            <DeviceBar />
            <ObjectList />
            <TimelinePanel />
        </div>
    )
}
