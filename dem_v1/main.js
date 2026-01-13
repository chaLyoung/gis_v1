// ========================================
// 서버 주소 설정
// ========================================
const TILESERVER_BASE_URL = 'http://10.200.100.11:8080'; 

// ✅ 두 개의 Terrain Server
const TERRAIN_SERVERS = {
    original: {
        url: 'http://10.200.100.11:8091',
        name: '원본 DEM (gumi_dem.tif)',
        description: '원본 수치표고모델'
    },
    generated: {
        url: 'http://10.200.100.11:8092', 
        name: '생성 DEM (gumi_gen_dem.tif)',
        description: 'AI 생성 수치표고모델'
    }
};

let currentTerrain = 'original';

// ========================================
// Cesium 뷰어 초기화
// ========================================
let viewer;

try {
    viewer = new Cesium.Viewer('cesiumContainer', {
        imageryProvider: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: true,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        scene3DOnly: true
    });
    
    console.log("✅ Cesium 뷰어 초기화 성공");
    
} catch (error) {
    console.error("🚨 Cesium 초기화 실패:", error);
    alert("Cesium 초기화 실패!\n" + error.message);
    throw error;
}

// 성능 설정
viewer.scene.fog.enabled = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.depthTestAgainstTerrain = true;

// ========================================
// 배경 지도 추가
// ========================================
viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
        url: `${TILESERVER_BASE_URL}/styles/OSM%20OpenMapTiles/{z}/{x}/{y}.png`,
        credit: 'OpenStreetMap contributors',
        maximumLevel: 14,
        rectangle: Cesium.Rectangle.fromDegrees(124.5, 33.0, 132.0, 38.8)
    }),
    0
);

// ========================================
// 마우스 컨트롤
// ========================================
const controller = viewer.scene.screenSpaceCameraController;
controller.enableRotate = true;
controller.enableTranslate = true;
controller.enableZoom = true;
controller.enableTilt = true;
controller.enableLook = false;

controller.translateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
controller.rotateEventTypes = Cesium.CameraEventType.RIGHT_DRAG;
controller.zoomEventTypes = Cesium.CameraEventType.WHEEL;
controller.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    {
        eventType: Cesium.CameraEventType.LEFT_DRAG,
        modifier: Cesium.KeyboardEventModifier.SHIFT
    }
];

controller.minimumZoomDistance = 10;
controller.maximumZoomDistance = 500000;

viewer.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
);

// ========================================
// 지형 전환 함수
// ========================================
async function switchTerrain(terrainKey) {
    const config = TERRAIN_SERVERS[terrainKey];
    if (!config) {
        console.error(`❌ Unknown terrain: ${terrainKey}`);
        return;
    }

    console.log(`🔄 지형 전환: ${config.name}`);
    updateTerrainStatus('loading', config.name);

    try {
        const provider = await Cesium.CesiumTerrainProvider.fromUrl(config.url, {
            requestVertexNormals: false
        });
        
        viewer.terrainProvider = provider;
        currentTerrain = terrainKey;
        
        console.log(`✅ ${config.name} 로딩 성공`);
        updateTerrainStatus('success', config.name);
        updateButtonStyles(terrainKey);
        
        if (typeof showNotification === 'function') {
            showNotification(`${config.name} 적용됨`, 'success');
        }
        
    } catch (error) {
        console.error(`❌ 지형 로딩 실패:`, error);
        updateTerrainStatus('error', config.name);
        
        if (typeof showNotification === 'function') {
            showNotification(`${config.name} 로딩 실패`, 'error');
        }
    }
}

// 상태 표시 업데이트
function updateTerrainStatus(status, name) {
    const statusEl = document.getElementById('terrain-status');
    if (!statusEl) return;

    const icons = { loading: '⏳', success: '✅', error: '❌' };
    const colors = { loading: '#FF9800', success: '#4CAF50', error: '#F44336' };
    
    statusEl.innerHTML = `${icons[status]} ${name}`;
    statusEl.style.borderLeftColor = colors[status];
}

// 버튼 스타일 업데이트
function updateButtonStyles(activeKey) {
    document.querySelectorAll('.terrain-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`btn-${activeKey}`);
    if (activeBtn) activeBtn.classList.add('active');
}

// ========================================
// 카메라 프리셋
// ========================================
function flyToGumi() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(128.35, 36.12, 15000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0
        },
        duration: 2
    });
}

function flyToGumiClose() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(128.35, 36.12, 3000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-30),
            roll: 0
        },
        duration: 2
    });
}

function flyToGumiSide() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(128.40, 36.10, 5000),
        orientation: {
            heading: Cesium.Math.toRadians(-45),
            pitch: Cesium.Math.toRadians(-25),
            roll: 0
        },
        duration: 2
    });
}

function resetCamera() {
    flyToGumi();
}

// ========================================
// 지형 과장 (높이 배율)
// ========================================
let terrainExaggeration = 1.0;

function setTerrainExaggeration(value) {
    terrainExaggeration = parseFloat(value);
    viewer.scene.verticalExaggeration = terrainExaggeration;
    
    const label = document.getElementById('exaggeration-label');
    if (label) label.textContent = `${terrainExaggeration.toFixed(1)}x`;
    
    console.log(`🏔️ 지형 과장: ${terrainExaggeration}x`);
}

// ========================================
// 초기 카메라 위치 (구미)
// ========================================
viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(128.35, 36.12, 15000),
    orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0
    }
});

// ========================================
// 초기 지형 로딩
// ========================================
setTimeout(() => {
    switchTerrain('original');
}, 1000);

// ========================================
// 전역 함수 등록
// ========================================
window.switchTerrain = switchTerrain;
window.resetCamera = resetCamera;
window.flyToGumi = flyToGumi;
window.flyToGumiClose = flyToGumiClose;
window.flyToGumiSide = flyToGumiSide;
window.setTerrainExaggeration = setTerrainExaggeration;

// ========================================
// 에러 핸들링
// ========================================
window.addEventListener('error', function(event) {
    console.error('🚨 전역 에러:', event.error);
});

viewer.scene.renderError.addEventListener(function(scene, error) {
    console.error('🚨 렌더링 에러:', error);
});

// ========================================
// 초기화 완료 로그
// ========================================
console.log("=".repeat(60));
console.log("✅ DEM 비교 시스템 초기화 완료");
console.log("=".repeat(60));
console.log("🏔️ 지형 전환:");
console.log("   switchTerrain('original')  - 원본 DEM");
console.log("   switchTerrain('generated') - 생성 DEM");
console.log("=".repeat(60));
console.log("📍 카메라:");
console.log("   flyToGumi()      - 구미 전체");
console.log("   flyToGumiClose() - 구미 근접");
console.log("   flyToGumiSide()  - 측면 뷰");
console.log("=".repeat(60));
console.log("🔧 지형 과장:");
console.log("   setTerrainExaggeration(2.0) - 높이 2배");
console.log("=".repeat(60));
