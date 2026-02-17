import { SceneControls } from './components/SceneControls'
import { ObjectControls } from './components/ObjectControls'
import { DeviceBar } from './components/DeviceBar'
import { ObjectList } from './components/ObjectList'
import { FPSCounter } from './components/FPSCounter'
import { RendererView } from './components/RendererView'
import { SvgUpload } from './components/SvgUpload'
import { useAutoCycle } from './hooks/useAutoCycle'
import { useSceneStore } from './store/sceneStore'

export default function App() {
    useAutoCycle();
    const theme = useSceneStore(state => state.scene.theme);

    return (
        <div className={`app-container ${theme}-theme`}>
            <RendererView />
            <FPSCounter />
            <SceneControls />
            <ObjectControls />
            <SvgUpload />
            <DeviceBar />
            <ObjectList />
        </div>
    )
}
