// ========================================
// 서버 주소 설정
// ========================================
const TILESERVER_BASE_URL = 'http://10.200.100.11:8080'; 

// 두 개의 Terrain Server
const TERRAIN_SERVERS = {
    original: {
        url: 'http://10.200.100.11:8091',
        name: '원본 DEM',
        color: '#FF6B6B'
    },
    generated: {
        url: 'http://10.200.100.11:8092', 
        name: '생성 DEM',
        color: '#4ECDC4'
    }
};

let currentTerrain = 'none';

// 포인트 데이터 중심 좌표 (동적으로 업데이트)
let DEM_CENTER = { lon: 128.35, lat: 36.1 };

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

// ========================================
// 지형 시각화 설정
// ========================================
viewer.scene.fog.enabled = false;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.globe.enableLighting = true;

viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2024-06-21T09:00:00Z');
viewer.clock.shouldAnimate = false;

viewer.scene.skyBox.show = false;
viewer.scene.sun.show = true;
viewer.scene.moon.show = false;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#1a1a2e');

// ========================================
// 배경 지도
// ========================================
let baseMapLayer = null;
let baseMapEnabled = true;

function initBaseMap() {
    baseMapLayer = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
            url: `${TILESERVER_BASE_URL}/styles/OSM%20OpenMapTiles/{z}/{x}/{y}.png`,
            credit: 'OpenStreetMap contributors',
            maximumLevel: 14,
            rectangle: Cesium.Rectangle.fromDegrees(124.5, 33.0, 132.0, 38.8)
        }),
        0
    );
    baseMapLayer.alpha = 0.6;
}

initBaseMap();

function toggleBaseMap() {
    baseMapEnabled = !baseMapEnabled;
    if (baseMapLayer) {
        baseMapLayer.show = baseMapEnabled;
    }
    updateToggleButton('btn-basemap', baseMapEnabled, '🗺️ 배경지도');
    return baseMapEnabled;
}

function setBaseMapOpacity(value) {
    if (baseMapLayer) {
        baseMapLayer.alpha = parseFloat(value);
        const label = document.getElementById('basemap-opacity-label');
        if (label) label.textContent = Math.round(value * 100) + '%';
    }
}

// ========================================
// 🔵 원본 DEM 포인트 클라우드
// ========================================
let originalPointsData = null;
let originalPointsCollection = null;
let originalPointsEnabled = false;
let originalPointsOpacity = 0.7;
let originalPointSize = 3;

async function toggleOriginalPoints() {
    if (originalPointsEnabled && originalPointsCollection) {
        viewer.scene.primitives.remove(originalPointsCollection);
        originalPointsCollection = null;
        originalPointsEnabled = false;
        updateToggleButton('btn-original-points', false, '🔵 원본 포인트');
        showNotification('원본 포인트 OFF', 'info');
        return false;
    }

    showNotification('원본 포인트 로딩 중...', 'info');

    try {
        if (!originalPointsData) {
            const response = await fetch('points_original.json');
            originalPointsData = await response.json();
            console.log(`원본 포인트 로드: ${originalPointsData.points.length}개`);
            
            // 중심 좌표 계산
            if (originalPointsData.points.length > 0) {
                updateCenterFromPoints(originalPointsData.points);
            }
        }
        
        renderOriginalPoints();
        originalPointsEnabled = true;
        
        updateToggleButton('btn-original-points', true, '🔵 원본 포인트');
        showNotification(`원본 포인트 ON (${originalPointsData.points.length}개)`, 'success');
        return true;
        
    } catch (error) {
        console.error('원본 포인트 로딩 실패:', error);
        showNotification('원본 포인트 로딩 실패 - JSON 파일 확인', 'error');
        return false;
    }
}

function renderOriginalPoints() {
    if (originalPointsCollection) {
        viewer.scene.primitives.remove(originalPointsCollection);
    }
    
    originalPointsCollection = new Cesium.PointPrimitiveCollection();
    
    const alpha = originalPointsOpacity;
    const color = Cesium.Color.fromCssColorString(`rgba(30, 144, 255, ${alpha})`);
    
    originalPointsData.points.forEach(p => {
        // p = [lon, lat, height]
        originalPointsCollection.add({
            position: Cesium.Cartesian3.fromDegrees(p[0], p[1], p[2] + 10), // 지형 위로 10m
            color: color,
            pixelSize: originalPointSize
        });
    });
    
    viewer.scene.primitives.add(originalPointsCollection);
}

function setOriginalPointsOpacity(value) {
    originalPointsOpacity = parseFloat(value);
    const label = document.getElementById('original-opacity-label');
    if (label) label.textContent = Math.round(value * 100) + '%';
    
    if (originalPointsEnabled && originalPointsData) {
        renderOriginalPoints();
    }
}

// ========================================
// 🔴 생성 DEM 포인트 클라우드
// ========================================
let generatedPointsData = null;
let generatedPointsCollection = null;
let generatedPointsEnabled = false;
let generatedPointsOpacity = 0.9;
let generatedPointSize = 5;

async function toggleGeneratedPoints() {
    if (generatedPointsEnabled && generatedPointsCollection) {
        viewer.scene.primitives.remove(generatedPointsCollection);
        generatedPointsCollection = null;
        generatedPointsEnabled = false;
        updateToggleButton('btn-generated-points', false, '🔴 생성 포인트');
        showNotification('생성 포인트 OFF', 'info');
        return false;
    }

    showNotification('생성 포인트 로딩 중...', 'info');

    try {
        if (!generatedPointsData) {
            const response = await fetch('points_generated.json');
            generatedPointsData = await response.json();
            console.log(`생성 포인트 로드: ${generatedPointsData.points.length}개`);
            
            // 중심 좌표 계산 (생성 영역 우선)
            if (generatedPointsData.points.length > 0) {
                updateCenterFromPoints(generatedPointsData.points);
            }
        }
        
        renderGeneratedPoints();
        generatedPointsEnabled = true;
        
        updateToggleButton('btn-generated-points', true, '🔴 생성 포인트');
        showNotification(`생성 포인트 ON (${generatedPointsData.points.length}개)`, 'success');
        return true;
        
    } catch (error) {
        console.error('생성 포인트 로딩 실패:', error);
        showNotification('생성 포인트 로딩 실패 - JSON 파일 확인', 'error');
        return false;
    }
}

function renderGeneratedPoints() {
    if (generatedPointsCollection) {
        viewer.scene.primitives.remove(generatedPointsCollection);
    }
    
    generatedPointsCollection = new Cesium.PointPrimitiveCollection();
    
    const alpha = generatedPointsOpacity;
    const color = Cesium.Color.fromCssColorString(`rgba(255, 60, 60, ${alpha})`);
    
    generatedPointsData.points.forEach(p => {
        // p = [lon, lat, height]
        generatedPointsCollection.add({
            position: Cesium.Cartesian3.fromDegrees(p[0], p[1], p[2] + 10), // 지형 위로 10m
            color: color,
            pixelSize: generatedPointSize
        });
    });
    
    viewer.scene.primitives.add(generatedPointsCollection);
}

function setGeneratedPointsOpacity(value) {
    generatedPointsOpacity = parseFloat(value);
    const label = document.getElementById('generated-opacity-label');
    if (label) label.textContent = Math.round(value * 100) + '%';
    
    if (generatedPointsEnabled && generatedPointsData) {
        renderGeneratedPoints();
    }
}

// ========================================
// 중심 좌표 계산
// ========================================
function updateCenterFromPoints(points) {
    if (points.length === 0) return;
    
    let sumLon = 0, sumLat = 0;
    points.forEach(p => {
        sumLon += p[0];
        sumLat += p[1];
    });
    
    DEM_CENTER.lon = sumLon / points.length;
    DEM_CENTER.lat = sumLat / points.length;
    
    console.log(`중심 좌표 업데이트: ${DEM_CENTER.lon.toFixed(4)}, ${DEM_CENTER.lat.toFixed(4)}`);
}

// ========================================
// 포인트 크기 조절
// ========================================
function setPointSize(value) {
    const size = parseInt(value);
    originalPointSize = size;
    generatedPointSize = size + 2;
    
    const label = document.getElementById('point-size-label');
    if (label) label.textContent = value + 'px';
    
    if (originalPointsEnabled && originalPointsCollection) {
        for (let i = 0; i < originalPointsCollection.length; i++) {
            originalPointsCollection.get(i).pixelSize = originalPointSize;
        }
    }
    
    if (generatedPointsEnabled && generatedPointsCollection) {
        for (let i = 0; i < generatedPointsCollection.length; i++) {
            generatedPointsCollection.get(i).pixelSize = generatedPointSize;
        }
    }
}

// ========================================
// 등고선 / 시각화 모드
// ========================================
let colorMode = 'none';

function setColorMode(mode) {
    colorMode = mode;
    
    switch (mode) {
        case 'none':
            viewer.scene.globe.material = undefined;
            break;
            
        case 'contour':
            viewer.scene.globe.material = Cesium.Material.fromType('ElevationContour', {
                color: Cesium.Color.fromCssColorString('#FFEB3B'),
                spacing: 30.0,
                width: 1.5
            });
            break;
            
        case 'contour-dense':
            viewer.scene.globe.material = Cesium.Material.fromType('ElevationContour', {
                color: Cesium.Color.fromCssColorString('#FF5722'),
                spacing: 10.0,
                width: 1.0
            });
            break;
    }
    
    document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`color-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    console.log(`🎨 시각화 모드: ${mode}`);
    return mode;
}

// ========================================
// 조명 제어
// ========================================
let lightingEnabled = true;

function toggleLighting() {
    lightingEnabled = !lightingEnabled;
    viewer.scene.globe.enableLighting = lightingEnabled;
    updateToggleButton('btn-lighting', lightingEnabled, '💡 조명');
    return lightingEnabled;
}

function setSunAngle(hour) {
    const time = Cesium.JulianDate.fromIso8601(`2024-06-21T${String(hour).padStart(2, '0')}:00:00Z`);
    viewer.clock.currentTime = time;
    const label = document.getElementById('sun-label');
    if (label) label.textContent = hour + '시';
}

// ========================================
// 토글 버튼 헬퍼
// ========================================
function updateToggleButton(btnId, enabled, text) {
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.className = enabled ? 'toggle-btn on' : 'toggle-btn off';
        btn.innerHTML = text;
    }
}

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
            requestVertexNormals: true
        });
        
        viewer.terrainProvider = provider;
        currentTerrain = terrainKey;
        
        console.log(`✅ ${config.name} 로딩 성공`);
        updateTerrainStatus('success', config.name, config.color);
        updateTerrainButtons(terrainKey);
        
        showNotification(`${config.name} 적용됨`, 'success');
        
    } catch (error) {
        console.error(`❌ 지형 로딩 실패:`, error);
        updateTerrainStatus('error', config.name, '#F44336');
        showNotification(`${config.name} 로딩 실패 - 서버 확인 필요`, 'error');
    }
}

function disableTerrain() {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider({});
    currentTerrain = 'none';
    updateTerrainButtons('none');
    updateTerrainStatus('success', '지형 없음', '#888');
    showNotification('지형 OFF', 'info');
}

function updateTerrainStatus(status, name, color = '#4CAF50') {
    const statusEl = document.getElementById('terrain-status');
    if (!statusEl) return;

    const icons = { loading: '⏳', success: '✅', error: '❌' };
    statusEl.innerHTML = `${icons[status]} ${name}`;
    statusEl.style.borderLeftColor = color;
}

function updateTerrainButtons(activeKey) {
    document.querySelectorAll('.terrain-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`btn-${activeKey}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const currentEl = document.getElementById('current-terrain');
    if (currentEl) {
        const names = { original: '원본', generated: '생성', none: '없음' };
        currentEl.textContent = names[activeKey] || activeKey;
    }
}

// ========================================
// 카메라 프리셋
// ========================================
function flyToCenter() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(DEM_CENTER.lon, DEM_CENTER.lat, 8000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0
        },
        duration: 2
    });
}

function flyToClose() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(DEM_CENTER.lon, DEM_CENTER.lat, 2000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-30),
            roll: 0
        },
        duration: 2
    });
}

function flyToSide() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(DEM_CENTER.lon + 0.03, DEM_CENTER.lat - 0.02, 4000),
        orientation: {
            heading: Cesium.Math.toRadians(-45),
            pitch: Cesium.Math.toRadians(-25),
            roll: 0
        },
        duration: 2
    });
}

function flyToTop() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(DEM_CENTER.lon, DEM_CENTER.lat, 5000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0
        },
        duration: 2
    });
}

function resetCamera() {
    flyToCenter();
}

// ========================================
// 지형 과장 (높이 배율)
// ========================================
function setTerrainExaggeration(value) {
    const exaggeration = parseFloat(value);
    viewer.scene.verticalExaggeration = exaggeration;
    
    const label = document.getElementById('exaggeration-label');
    if (label) label.textContent = `${exaggeration.toFixed(1)}x`;
    
    console.log(`🏔️ 지형 과장: ${exaggeration}x`);
}

// ========================================
// 초기 카메라 위치 (한국 중심)
// ========================================
viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(DEM_CENTER.lon, DEM_CENTER.lat, 50000),
    orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0
    }
});

// ========================================
// 초기 설정 (지형 없이 시작)
// ========================================
setTimeout(() => {
    disableTerrain();
    setColorMode('none');
}, 500);

// ========================================
// 전역 함수 등록
// ========================================
window.switchTerrain = switchTerrain;
window.disableTerrain = disableTerrain;
window.resetCamera = resetCamera;
window.flyToCenter = flyToCenter;
window.flyToClose = flyToClose;
window.flyToSide = flyToSide;
window.flyToTop = flyToTop;
window.setTerrainExaggeration = setTerrainExaggeration;
window.setColorMode = setColorMode;
window.toggleLighting = toggleLighting;
window.setSunAngle = setSunAngle;
window.toggleBaseMap = toggleBaseMap;
window.setBaseMapOpacity = setBaseMapOpacity;
window.toggleOriginalPoints = toggleOriginalPoints;
window.setOriginalPointsOpacity = setOriginalPointsOpacity;
window.toggleGeneratedPoints = toggleGeneratedPoints;
window.setGeneratedPointsOpacity = setGeneratedPointsOpacity;
window.setPointSize = setPointSize;

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
console.log("✅ DEM 포인트 클라우드 비교 시스템 초기화 완료");
console.log("=".repeat(60));
console.log("🔵🔴 포인트 클라우드:");
console.log("   toggleOriginalPoints()     - 원본 포인트 (파랑)");
console.log("   toggleGeneratedPoints()    - 생성 포인트 (빨강)");
console.log("=".repeat(60));
