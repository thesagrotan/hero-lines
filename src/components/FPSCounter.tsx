import { useSceneStore } from '../store/sceneStore';
import './FPSCounter.css';

export const FPSCounter = () => {
    const fps = useSceneStore((state) => state.fps);

    return (
        <div className="fps-counter">
            FPS: {fps}
        </div>
    );
};
