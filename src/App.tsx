import { useRef } from 'react'
import { SceneControls } from './components/SceneControls'
import { ObjectControls } from './components/ObjectControls'
import { DeviceBar } from './components/DeviceBar'
import { TimelinePanel } from './components/TimelinePanel'
import { ObjectList } from './components/ObjectList'
import { FPSCounter } from './components/FPSCounter'
import { RendererView } from './components/RendererView'
import { useAutoCycle } from './hooks/useAutoCycle'

import { useSceneStore } from './store/sceneStore'

export default function App() {
    useAutoCycle();
    const timelineRef = useRef<any>(null);
    const theme = useSceneStore(state => state.scene.theme);

    return (
        <div className={`app-container ${theme}-theme`}>
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
