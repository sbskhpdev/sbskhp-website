// SBSKHP 교육 서비스 플랫폼 - 메인 JavaScript 파일

// 구글 앱스크립트 API URL
const API_URL = "https://script.google.com/macros/s/AKfycbwkBLDzJKbSWYDGv8EmcgpUPRuVHh3ueYumaPBHy5OzTe42idUniJdUvJKsm0z4JwyW/exec";

// 전역 데이터 캐시
let cachedEducationData = null;
let cachedFaqData = null;
let cachedCompanyData = null;

// 현재 활성 페이지 상태
let currentPage = null;

// 초기화 여부 확인을 위한 플래그
let isInitializing = true;

// 날짜 형식 변환 헬퍼 (GAS에서 온 날짜 데이터 처리)
function formatDate(dateVal) {
    if (!dateVal) return '';
    try {
        const date = new Date(dateVal);
        if (isNaN(date.getTime())) return dateVal;
        
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}.${m}.${d}`;
    } catch (e) {
        return dateVal;
    }
}

// 텍스트 포맷팅 (Markdown 스타일 **볼드** 처리)
function parseMarkdown(text) {
    if (!text) return '';
    // **텍스트** -> <strong>텍스트</strong>
    return String(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// 구글 드라이브 이미지 주소를 직접 링크 주소로 변환
function formatDriveImageUrl(url) {
    if (!url || typeof url !== 'string') return url;
    
    // 이미 변환된 주소이거나 다른 호스팅 주소인 경우 그대로 반환
    if (!url.includes('drive.google.com')) return url;
    
    try {
        let fileId = '';
        
        // /file/d/ID/view 형식 처리
        if (url.includes('/file/d/')) {
            fileId = url.split('/file/d/')[1].split('/')[0];
        } 
        // ?id=ID 형식 처리
        else if (url.includes('id=')) {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            fileId = urlParams.get('id');
        }
        
        if (fileId) {
            // direct link 형식으로 변환
            return `https://lh3.googleusercontent.com/u/0/d/${fileId}`;
        }
    } catch (e) {
        console.error("Drive URL 변환 실패:", e);
    }
    
    return url;
}

// 교육 필터 설정
function setupEducationFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const educationCards = document.querySelectorAll('.education-card');
    
    if (!filterButtons.length || !educationCards.length) return;

    filterButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const filterValue = this.getAttribute('data-filter');
            
            // 버튼 스타일 업데이트
            filterButtons.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'white';
                b.style.color = '#374151';
            });
            this.classList.add('active');
            this.style.background = '#3b82f6';
            this.style.color = 'white';
            
            // 카드 필터링
            educationCards.forEach(card => {
                if (filterValue === 'all' || card.getAttribute('data-status') === filterValue) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });
}

// 교육 데이터 가져오기 (API 호출 및 캐싱)
async function getEducationData() {
    if (cachedEducationData) return cachedEducationData;
    try {
        const response = await fetch(`${API_URL}?type=Education`);
        const data = await response.json();
        // ID가 문자열로 올 수 있으므로 숫자로 변환 처리 (시트에서 숫자도 문자열로 넘어오는 경우가 많음)
        cachedEducationData = data.map(item => ({
            ...item,
            id: parseInt(item.ID) || item.ID,
            Image: formatDriveImageUrl(item.Image) // 드라이브 링크 자동 변환
        }));
        return cachedEducationData;
    } catch (error) {
        console.error("교육 데이터 로드 실패:", error);
        return [];
    }
}

// SBS 계열사 데이터 가져오기
async function getCompanyData() {
    if (cachedCompanyData) return cachedCompanyData;
    try {
        const response = await fetch(`${API_URL}?type=SBS%20Companys`);
        const data = await response.json();
        if (Array.isArray(data)) {
            cachedCompanyData = data.map(item => item['Company Name']).filter(Boolean);
            return cachedCompanyData;
        }
        return [];
    } catch (error) {
        console.error("계열사 데이터 로드 실패:", error);
        return [];
    }
}

// 교육 데이터를 제목(Title) 기준으로 그룹화
function getGroupedEducationData(data) {
    const groups = {};
    data.forEach(item => {
        if (!groups[item.Title]) {
            groups[item.Title] = {
                ...item,
                rounds: []
            };
        }
        groups[item.Title].rounds.push({
            id: item.id,
            round: item['회차'],
            startDate: item['Start Date'],
            endDate: item['End Date'],
            status: item.Status,
            eventId: item['Event ID']
        });
    });

    // 각 그룹의 대표 상태 결정 (모집중이 하나라도 있으면 모집중, 아니면 가장 긍정적인 상태 순)
    return Object.values(groups).map(group => {
        const statuses = group.rounds.map(r => r.status);
        let finalStatus = '마감';
        
        if (statuses.includes('모집중')) finalStatus = '모집중';
        else if (statuses.includes('모집예정')) finalStatus = '모집예정';
        else if (statuses.includes('모집마감')) finalStatus = '모집마감';
        else if (statuses.includes('폐강')) finalStatus = '폐강';
        
        return {
            ...group,
            displayStatus: finalStatus
        };
    });
}

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    handleInitialRoute();
});

// 앱 초기화
function initializeApp() {
    console.log('SBSKHP 교육 서비스 플랫폼 초기화');
    
    // 브라우저 뒤로/앞으로 버튼 처리 (통합된 라우터 사용)
    window.addEventListener('popstate', handleRouter);
    
    // Hash 변경도 감지 (일부 구형 브라우저 및 일관성 피드백 대응)
    window.addEventListener('hashchange', handleRouter);
    
    // 외부 클릭시 모바일 메뉴 닫기
    document.addEventListener('click', handleOutsideClick);
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 로고 및 메인 내비게이션 링크 감시
    document.addEventListener('click', function(event) {
        const link = event.target.closest('a[data-page]');
        if (link) {
            handleNavigation(event);
        }
    });
    
    // 모바일 메뉴 토글 버튼
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', toggleMobileMenu);
    }
    
    // 에러 모달 닫기 버튼
    const errorClose = document.getElementById('error-close');
    if (errorClose) {
        errorClose.addEventListener('click', closeErrorModal);
    }
}

// 초기 라우트 처리
async function handleInitialRoute() {
    await handleRouter();
}

// 통합 라우터 함수 (초기 로드, 뒤로가기, 페이지 이동 통합 관리)
async function handleRouter() {
    const params = getURLParams();
    
    // 현재 페이지가 렌더링된 것과 다르거나 초기화 중인 경우 페이지 로드
    if (currentPage !== params.page || isInitializing) {
        isInitializing = false;
        await loadPage(params.page);
    }
    
    // 상세 페이지(모달) 처리
    const currentModal = document.getElementById('education-modal');
    if (params.detail) {
        // 모달이 없거나 열려있더라도 파라미터가 있으면 호출 (openEducationModal 내부에서 중복 체크 및 제거 수행)
        if (!currentModal) {
            openEducationModal(params.detail);
        }
    } else {
        // URL에 detail이 없는데 모달이 열려있으면 UI만 닫기
        if (currentModal) {
            closeEducationModal(false); 
        }
    }
}

// 내비게이션 클릭 처리
function handleNavigation(event) {
    const link = event.target.closest('a[data-page]');
    if (!link) return;

    event.preventDefault();
    const page = link.getAttribute('data-page');
    
    if (page && isValidPage(page)) {
        updateURL(page);
        closeMobileMenu();
    }
}

// 유효한 페이지인지 확인
function isValidPage(page) {
    const validPages = ['home', 'schedule', 'education', 'apply', 'confirm', 'faq', 'contact', 'privacy'];
    return validPages.includes(page);
}

// URL 파라미터 파싱 함수
function getURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const hashPage = window.location.hash.slice(1);
    
    // 1. 쿼리 파라미터 'page' 우선, 없으면 Hash, 그것도 없으면 'home'
    let page = urlParams.get('page') || hashPage || 'home';
    
    if (!isValidPage(page)) {
        page = 'home';
    }

    return {
        page: page,
        detail: urlParams.get('detail')
    };
}

// URL 업데이트 함수
function updateURL(page, detail = null) {
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    
    if (detail) {
        url.searchParams.set('detail', detail);
    } else {
        url.searchParams.delete('detail');
    }
    
    url.hash = page;
    
    if (window.location.href !== url.href) {
        window.history.pushState({ page, detail }, '', url);
        // pushState는 popstate를 트리거하지 않으므로 수동으로 라우터 호출
        handleRouter();
    }
}

// 페이지 로드 메인 함수
async function loadPage(page) {
    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
        contentContainer.innerHTML = '';
        contentContainer.classList.remove('content-fade-in');
    }

    showLoadingSpinner();
    updateActiveNavigation(page);
    currentPage = page;
    
    try {
        let content = '';
        
        switch(page) {
            case 'home':
                content = renderHomePage();
                break;
            case 'schedule':
                content = renderSchedulePage();
                break;
            case 'education':
                content = await renderEducationPage();
                break;
            case 'apply':
                content = await renderApplyPage();
                break;
            case 'confirm':
                content = renderConfirmPage();
                break;
            case 'faq':
                content = await renderFaqPage();
                break;
            case 'contact':
                content = renderContactPage();
                break;
            case 'privacy':
                content = renderPrivacyPage();
                break;
            default:
                content = renderHomePage();
        }
        
        const contentContainer = document.getElementById('content-container');
        if (contentContainer) {
            contentContainer.innerHTML = content;
            contentContainer.className = 'content-fade-in';
            
            // 페이지별 추가 초기화
            initializePageSpecificFeatures(page);
        }
        
    } catch (error) {
        console.error('페이지 로드 오류:', error);
        showErrorModal('페이지를 불러오는 중 오류가 발생했습니다.');
    } finally {
        hideLoadingSpinner();
    }
}

// 활성 내비게이션 업데이트
function updateActiveNavigation(page) {
    // 데스크톱 내비게이션
    const desktopNavItems = document.querySelectorAll('#desktop-nav .nav-item');
    desktopNavItems.forEach(item => {
        const itemPage = item.getAttribute('data-page');
        if (itemPage === page) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // 모바일 내비게이션
    const mobileNavItems = document.querySelectorAll('#mobile-nav .mobile-nav-item');
    mobileNavItems.forEach(item => {
        const itemPage = item.getAttribute('data-page');
        if (itemPage === page) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// 홈 페이지 렌더링
function renderHomePage() {
    return `
        <div class="content-card content-card-1" style="position: relative; overflow: hidden; background-color: transparent; box-shadow: none; border: none;">
            <video autoplay muted loop playsinline style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0;">
                <source src="./assets/image/home-bg.mp4" type="video/mp4">
            </video>
            <div class="content-card-1-1" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5rem; margin-bottom: 3rem; position: relative; z-index: 1;">
                <div style="padding: 1.5rem .5rem; border-radius: 8px; text-align: center; cursor: pointer;" class="hover-lift" onclick="updateURL('schedule');">
                    <div style="width: 48px; height: 48px; margin: 0 auto 1rem; background-color: #4f46e5; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <svg style="width: 24px; height: 24px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                    </div>
                    <h3 style="font-weight: 600; margin-bottom: 0.5rem;">교육일정</h3>
                    <p class="service-description" style="color: #6b7280; font-size: 0.875rem;">최신 교육 일정을 확인하세요</p>
                </div>
                
                <div style="padding: 1.5rem .5rem; border-radius: 8px; text-align: center; cursor: pointer;" class="hover-lift" onclick="updateURL('education');">
                    <div style="width: 48px; height: 48px; margin: 0 auto 1rem; background-color: #059669; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <svg style="width: 24px; height: 24px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                        </svg>
                    </div>
                    <h3 style=" font-weight: 600; margin-bottom: 0.5rem;">교육정보</h3>
                    <p class="service-description" style="color: #6b7280; font-size: 0.875rem;">전문 강사진이 제공하는 체계적인 교육 프로그램</p>
                </div>
                
                <div style="padding: 1.5rem .5rem; border-radius: 8px; text-align: center; cursor: pointer;" class="hover-lift" onclick="updateURL('apply');">
                    <div style="width: 48px; height: 48px; margin: 0 auto 1rem; background-color: #d97706; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <svg style="width: 24px; height: 24px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path    stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                    </div>
                    <h3 style=" font-weight: 600; margin-bottom: 0.5rem;">교육신청</h3>
                    <p class="service-description" style="color: #6b7280; font-size: 0.875rem;">온라인으로 간편하게 교육 신청 및 확인 가능</p>
                </div>
            </div>
            <!-- 히어로 섹션 -->
            <div class="hero-section" style="position: relative; border-radius: 24px; padding: 8rem 3rem; margin-bottom: 4rem; overflow: hidden;">
                <div style="position: relative; z-index: 2; max-width: 800px; margin: 0 auto; text-align: center;">
                    <div style="color: #9CA3AF; font-size: 1rem; font-weight: 500; margin-bottom: 1rem; letter-spacing: 0.05em;">미래 콘텐츠 산업을 이끌</div>
                    <h1 style="font-size: 3rem; font-weight: 800; line-height: 1.2; margin-bottom: 1.5rem; color: #F59E0B;text-shadow: rgba(245, 158, 11, 0.3) 0px 4px 15px;">
                        인재와 기술이 만나는 곳
                    </h1>
                    
                    <div style="font-size: 1.1rem; line-height: 1.7; margin-bottom: 2rem; font-weight: 400; color: #6B7280;">
                        <p style="margin-bottom: 1rem;">SBS A&T의 Hightech Platform은 콘텐츠 산업의 미래를 이끌 창의적 인재 양성과 
                        첨단 미디어 기술의 융합을 목표로 탄생한 실무 중심의 교육·실습 플랫폼입니다</p>
                        
                        <p style="margin: 0;">차세대 미디어 기술을 현업 전문가와 함께 직접 체험하고<br>
                        제작하는 현장 맞춤형 커리큘럼을 제공합니다</p>
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem;">
                        <button onclick="updateURL('education');" style="background: #F59E0B; border: none; color: white; font-weight: 600; padding: 1rem 2rem; border-radius: 50px; cursor: pointer; transition: all 0.3s; font-size: 1rem; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(245, 158, 11, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(245, 158, 11, 0.3)'">
                            지금 시작하기
                        </button>
                    </div>
                </div>
            </div>
            
            <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; padding: 2rem; border-radius:8px; text-align: center; margin:-24px; position: relative; z-index: 1;">
                <h2 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">지금 시작해보세요!</h2>
                <p style="margin-bottom: 1.5rem;">최신 교육 정보를 확인하고 원하는 과정에 신청하세요</p>
                <div style="display: flex; flex-direction: column; gap: 1rem; align-items: center;">
                    <button onclick="updateURL('education');" style="background-color: white; color: #4f46e5; font-weight: 600; padding: 12px 24px; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.backgroundColor='#f3f4f6'" onmouseout="this.style.backgroundColor='white'">
                        교육 정보 보기
                    </button>
                    <button onclick="updateURL('apply');" style="border: 2px solid white; background: transparent; color: white; font-weight: 600; padding: 12px 24px; border-radius: 6px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.backgroundColor='white'; this.style.color='#4f46e5'" onmouseout="this.style.backgroundColor='transparent'; this.style.color='white'">
                        교육 신청하기
                    </button>
                </div>
            </div>
        </div>
        
        <style>
        .content-card-1-1 .hover-lift:hover {
            box-shadow: none !important;
            position: relative !important;
        }

        .hero-section {
            position: relative !important;
            border-radius: 24px !important;
            overflow: hidden !important;
        }
        
        .testimonial-chip:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
            transition: all 0.2s ease;
        }
        
        @media (max-width: 1024px) {
            .hero-section {
                padding: 3rem 2rem !important;
            }
            
            .hero-section h1 {
                font-size: 2.5rem !important;
            }
            
            .hero-section div:nth-child(1) > div:nth-child(3) {
                font-size: 1rem !important;
            }
        }
        
        @media (max-width: 768px) {
            .hero-section {
                padding: 2.5rem 1.5rem !important;
                margin-bottom: 2.5rem !important;
            }
            
            .hero-section div:first-child {
                font-size: 0.9rem !important;
            }
            
            .hero-section h1 {
                font-size: 2rem !important;
                line-height: 1.3 !important;
            }
            
            .hero-section div:nth-child(1) > div:nth-child(3) {
                font-size: 0.95rem !important;
            }
            
            .hero-section div:nth-child(1) > div:nth-child(3) p {
                margin-bottom: 1.5rem !important;
            }
            
            .hero-section div:last-child {
                gap: 0.75rem !important;
            }
            
            .hero-section button {
                padding: 0.875rem 1.5rem !important;
                font-size: 0.9rem !important;
            }
            
            .testimonials-container {
                max-width: 100% !important;
                padding: 0 1rem;
            }
            
            .testimonial-chip {
                flex-direction: column !important;
                text-align: center !important;
                gap: 0.75rem !important;
                padding: 1rem !important;
            }
            
            .testimonial-chip > div:last-child {
                text-align: left !important;
            }
            
            .service-description {
                display: none !important;
            }
        }
        @media (max-width: 480px) {
            .content-card-1 h3 {
                font-size: .9rem !important;
            }
        }
        </style>
        

    `;
}

// 교육 일정 페이지 렌더링
function renderSchedulePage() {
    // 구글 캘린더 ID: sbskhpdev@gmail.com
    const calendarId = "sbskhpdev@gmail.com";
    const googleCalendarSrc = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=Asia%2FSeoul&showTitle=0&showPrint=0&showTabs=1&showCalendars=0&showTz=0`;
    
    return `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">AI 교육 일정</h1>
            <p style="color: #6b7280; margin-bottom: 1.5rem;">구글 캘린더를 통해 실시간으로 업데이트되는 교육 일정을 확인하세요.</p>
            
            <div class="calendar-container">
                <iframe 
                    src="${googleCalendarSrc}" 
                    style="border: 0; width: 100%; height: 600px; border-radius: 8px;" 
                    frameborder="0" 
                    scrolling="no">
                </iframe>
            </div>
        </div>
        
        <style>
        .calendar-container {
            width: 100%;
            overflow: hidden;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            border: 1px solid #e5e7eb;
            background: white;
            padding: 10px;
        }
        
        @media (max-width: 768px) {
            .calendar-container {
                padding: 5px;
            }
            .calendar-container iframe {
                height: 500px;
            }
        }
        </style>
    `;
}

// 교육 정보 페이지 렌더링
async function renderEducationPage() {
    const rawData = await getEducationData();
    const educationData = getGroupedEducationData(rawData);

    let content = `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">AI 교육 정보</h1>
            <p style="color: #6b7280; margin-bottom: 2rem;">최신 AI 기술을 배울 수 있는 다양한 교육 과정을 제공합니다.</p>
            
            <!-- 필터 버튼 -->
            <div class="filter-buttons" style="display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap;">
                <button class="filter-btn active" data-filter="all" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: #3b82f6; color: white; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">전체</button>
                <button class="filter-btn" data-filter="모집중" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">모집중</button>
                <button class="filter-btn" data-filter="모집마감" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">모집마감</button>
                <button class="filter-btn" data-filter="모집예정" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">모집예정</button>
                <button class="filter-btn" data-filter="마감" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">마감</button>
                <button class="filter-btn" data-filter="폐강" style="padding: 8px 16px; border-radius: 20px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s;">폐강</button>
            </div>
            
            <div class="education-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem;">
    `;
    
    educationData.forEach((edu) => {
        content += `
            <div class="education-card" data-status="${edu.displayStatus}" onclick="updateURL('education', '${edu.id}')" style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); transition: all 0.3s; cursor: pointer;">
                <div style="position: relative; width: 100%; height: 200px; overflow: hidden; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <img src="${edu.Image || 'assets/noimage.png'}" alt="${edu.Title}" 
                         style="width: 100%; height: 100%; object-fit: cover; opacity: 0.9;"
                         onerror="this.src='assets/noimage.png'">
                    <div style="position: absolute; top: 12px; right: 12px;">
                        <span class="status-badge" style="display: inline-block; background-color: ${getStatusColor(edu.displayStatus)}; color: white; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 20px;">
                            ${edu.displayStatus}
                        </span>
                    </div>
                </div>
                
                <div style="padding: 1.5rem;">
                    <h3 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.5rem 0; color: #1f2937;">${edu.Title}</h3>
                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #6b7280; line-height: 1.5; height: 2.6rem; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                        ${edu.Description || ''}
                    </p>
                    <div style="font-size: 0.85rem; color: #6b7280;">
                        ${edu.Location || '추후 공지'}
                    </div>
                </div>
            </div>
        `;
    });
    
    content += `
            </div>
        </div>
    `;
    
    // 교육 카드 호버 효과 및 모바일 그리드를 위한 스타일 추가
    content += `
        <style>
        .education-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15) !important;
        }
        
        .filter-btn:hover {
            background: #f3f4f6 !important;
            border-color: #d1d5db !important;
        }
        
        .filter-btn.active {
            background: #3b82f6 !important;
            color: white !important;
            border-color: #3b82f6 !important;
        }
        
        .education-card.hidden {
            display: none !important;
        }
        
        /* 기본: 4열 */
        .education-grid {
            grid-template-columns: repeat(4, 1fr) !important;
        }
        
        /* 중간 크기: 3열 */
        @media (max-width: 1200px) {
            .education-grid {
                grid-template-columns: repeat(3, 1fr) !important;
            }
        }
        
        /* 태블릿: 2열 */
        @media (max-width: 900px) {
            .education-grid {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 1rem !important;
            }
        }
        
        /* 모바일: 2열 유지 */
        @media (max-width: 768px) {
            .education-grid {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 1rem !important;
            }
            
            .education-card {
                min-height: auto;
            }
            
            .education-card > div:first-child {
                height: 150px !important;
            }
            
            .education-card h3 {
                font-size: 1rem !important;
            }
            
            .education-card p {
                font-size: 0.8rem !important;
            }
            
            .education-card > div:last-child {
                padding: 1rem !important;
            }
            
            .filter-buttons {
                justify-content: center !important;
            }
        }
        
        /* 작은 모바일: 1열 */
        @media (max-width: 480px) {
            .education-grid {
                grid-template-columns: 1fr !important;
            }
        }
        </style>
        
        <script>
        // 필터 기능 초기화
        setTimeout(() => {
            const filterBtns = document.querySelectorAll('.filter-btn');
            const educationCards = document.querySelectorAll('.education-card');
            
            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const filter = btn.getAttribute('data-filter');
                    
                    // 활성 버튼 변경
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // 카드 필터링
                    educationCards.forEach(card => {
                        const cardStatus = card.getAttribute('data-status');
                        if (filter === 'all' || cardStatus === filter) {
                            card.classList.remove('hidden');
                        } else {
                            card.classList.add('hidden');
                        }
                    });
                });
            });
        }, 100);
        </script>
    `;
    
    return content;
}

// 상태에 따른 색상 반환
function getStatusColor(status) {
    switch(status) {
        case '모집중': return '#059669';
        case '마감':
        case '모집마감': return '#6b7280';
        case '모집예정': return '#3b82f6';
        case '폐강': return '#ef4444';
        default: return '#6b7280';
    }
}

// 연락처 페이지 렌더링
function renderContactPage() {
    return `
        <div class="content-card">
            
            <!-- 지도 섹션 -->
            <div style="margin-bottom: 1rem;">
                <h2 style="font-size: 1.5rem; font-weight: 600; color: #1f2937; margin-bottom: 1rem;">오시는 길</h2>
                <div style="border-radius: 12px; overflow: hidden; height: 400px; border: 1px solid #e2e8f0;">
                    <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3164.9023843214486!2d126.74436379999999!3d37.5102204!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x357b7d316991b561%3A0x7577edf74b7a0694!2z7Ju57Yiw7Jy17ZWp7IS87YSwIOuwjyDrtoDsspzsmIHsg4Eg7LKt64WE7JiY7Iig7J24IOyjvO2DnQ!5e0!3m2!1sko!2skr!4v1763616057176!5m2!1sko!2skr" 
                            style="width: 100%; height: 100%; border: 0;" 
                            allowfullscreen="" 
                            loading="lazy" 
                            referrerpolicy="no-referrer-when-downgrade">
                    </iframe>
                </div>
            </div>
            
            <!-- 연락처 정보 그리드 -->
            <div style="margin-bottom: 1rem;">
                <p style="color: #374151; line-height: 1.6; margin: 0; font-size: 1.2rem; font-weight: bold; margin-bottom: 0.5rem;">(14505)경기도 부천시 원미구 길주로 17(상동 529-28), 웹툰융합센터</p>
                <p style="color: #374151; line-height: 1.6; margin: 0 0 0.5rem;">
                    <strong>교육문의:</strong> haba98@sbs.co.kr<br>
                </p>
            </div>
        </div>
        
        <style>
        .content-card h3 {
            font-size: 1.25rem;
        }
        
        @media (max-width: 768px) {
            .content-card h3 {
                font-size: 0.95rem !important;
            }
            
            .content-card > div:nth-child(4) {
                grid-template-columns: 1fr !important;
                gap: 1rem !important;
            }
            
            .content-card > div:nth-child(4) > div {
                padding: 1.5rem !important;
            }
            
            .content-card > div:nth-child(3) > div {
                height: 300px !important;
            }
            
            .content-card > div:last-child > div:last-child {
                grid-template-columns: 1fr !important;
            }
        }
        </style>
    `;
}

// 교육 신청 페이지 렌더링
async function renderApplyPage() {
    const rawData = await getEducationData();
    // 모집중이거나 준비중인 회차가 하나라도 있는 과정들만 필터링
    const groupedData = getGroupedEducationData(rawData).filter(group => 
        group.rounds.some(r => r.status === '모집중' || r.status === '모집예정')
    );

    return `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">교육 신청</h1>
            <p style="color: #6b7280; margin-bottom: 1.5rem;">원하시는 교육 과정에 신청해주세요. 신청 완료 후 담당자가 연락드립니다.</p>
            
            <!-- 신청 폼 유형 선택 -->
            <div style="display: flex; gap: 0.5rem; margin-bottom: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem;">
                <button type="button" class="form-type-btn active" data-type="general" style="padding: 10px 20px; border-radius: 8px; border: 1px solid #3b82f6; background: #3b82f6; color: white; cursor: pointer; font-weight: 600; transition: all 0.2s;">일반 신청</button>
                <button type="button" class="form-type-btn" data-type="sbs" style="padding: 10px 20px; border-radius: 8px; border: 1px solid #e5e7eb; background: white; color: #374151; cursor: pointer; font-weight: 600; transition: all 0.2s;">SBS 계열사 직원 신청</button>
            </div>

            <form id="apply-form" style="max-width: 600px;">
                <input type="hidden" id="apply-form-type" value="general">
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">이름 *</label>
                    <input type="text" id="apply-name" class="form-input" placeholder="홍길동" required>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">이메일 *</label>
                    <input type="email" id="apply-email" class="form-input" placeholder="example@email.com" required>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">연락처 *</label>
                    <input type="tel" id="apply-phone" class="form-input" placeholder="010-1234-5678" required>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                    <div>
                        <label class="form-label">희망 교육 과정 *</label>
                        <select id="apply-course" class="form-input" required style="cursor: pointer;">
                            <option value="">교육 과정을 선택해주세요</option>
                            ${groupedData.map(group => `
                                <option value="${group.Title}">${group.Title}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">회차 선택 *</label>
                        <select id="apply-round" class="form-input" required style="cursor: pointer;" disabled>
                            <option value="">과정을 먼저 선택해주세요</option>
                        </select>
                    </div>
                </div>
                
                <div id="employment-section" style="margin-bottom: 1.5rem;">
                    <label class="form-label">재직여부</label>
                    <select id="apply-employment" class="form-input" style="cursor: pointer;" required>
                        <option value="">선택해주세요</option>
                        <option value="재직중">재직중</option>
                        <option value="구직중">구직중</option>
                        <option value="학생">학생</option>
                        <option value="프리랜서">프리랜서</option>
                        <option value="기타">기타</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">회사명 <span id="company-suffix">(재직중인 경우)</span></label>
                    <div id="company-input-container">
                        <input type="text" id="apply-company" class="form-input" placeholder="회사명을 입력해주세요">
                    </div>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">직군/직급</label>
                    <input type="text" id="apply-position" class="form-input" placeholder="예: 개발자/주임, 마케터/팀장, 학생 등" required>
                </div>
                
                <div style="margin-bottom: 2rem;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="apply-agree" required style="width: 16px; height: 16px;">
                        <span style="font-size: 14px; color: #374151;">개인정보 수집 및 이용에 동의합니다. *</span>
                    </label>
                    <div style="margin-top: 4px; padding-left: 24px;">
                        <button type="button" onclick="openPrivacyModal()" style="font-size: 12px; color: #3b82f6; background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline;">내용 보기</button>
                    </div>
                </div>
                
                <div style="margin-bottom: 2rem; padding: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">
                        <strong style="color: #374151;">안내사항:</strong> 일부 교육은 고용노동부 협약 사업으로 고용보험 가입여부 확인을 위해 주민등록번호를 요청할 수 있습니다.
                    </p>
                </div>
                
                <button type="submit" class="btn-primary" style="width: 100%;">
                    신청 완료
                </button>
            </form>
            
            <div id="apply-result" style="margin-top: 2rem;"></div>
        </div>
    `;
}

// 신청 확인 페이지 렌더링
function renderConfirmPage() {
    return `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">신청 확인</h1>
            <p style="color: #6b7280; margin-bottom: 1.5rem;">이름과 이메일을 입력하여 신청 내역을 확인하세요.</p>
            
            <form id="confirm-form" style="max-width: 448px;">
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">이름</label>
                    <input type="text" id="confirm-name" class="form-input" placeholder="홍길동" required>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label class="form-label">이메일</label>
                    <input type="email" id="confirm-email" class="form-input" placeholder="example@email.com" required>
                </div>
                
                <button type="submit" class="btn-primary" style="width: 100%;">
                    신청 내역 조회
                </button>
            </form>
            
            <div id="confirm-result" style="margin-top: 2rem;"></div>
        </div>
    `;
}

// FAQ 데이터 가져오기
async function getFaqData() {
    if (cachedFaqData) return cachedFaqData;
    try {
        const response = await fetch(`${API_URL}?type=FAQ`);
        const data = await response.json();
        
        // 데이터가 배열이 아니거나 에러가 포함된 경우 처리
        if (!Array.isArray(data)) {
            console.error("FAQ 데이터 형식이 올바르지 않습니다:", data);
            return [];
        }
        
        cachedFaqData = data;
        return cachedFaqData;
    } catch (error) {
        console.error("FAQ 데이터 로드 실패:", error);
        return [];
    }
}

// FAQ 페이지 렌더링
async function renderFaqPage() {
    const faqData = await getFaqData();

    let content = `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">자주 묻는 질문</h1>
            <p style="color: #6b7280; margin-bottom: 1.5rem;">궁금한 사항을 빠르게 확인해보세요.</p>
    `;
    
    if (faqData.length === 0) {
        content += `<p style="text-align: center; color: #6b7280; margin: 3rem 0;">등록된 자주 묻는 질문이 없습니다.</p>`;
    }

    faqData.forEach((faq, index) => {
        content += `
            <div class="faq-item" style="border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; overflow: hidden;">
                <button class="faq-question" data-faq="${index}" style="width: 100%; text-align: left; padding: 1.5rem; background-color: #f9fafb; border: none; font-weight: 600; color: #1f2937; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background-color 0.2s;">
                    ${faq.Question || faq.question}
                    <svg class="faq-icon" style="width: 20px; height: 20px; transform: rotate(0deg); transition: transform 0.2s;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                </button>
                <div class="faq-answer faq-hidden" id="faq-answer-${index}" style="padding: 1.5rem; background-color: white; color: #374151; border-top: 1px solid #e5e7eb; line-height: 1.6;">
                    ${faq.Answer || faq.answer}
                </div>
            </div>
        `;
    });
    
    content += '</div>';
    
    // FAQ 상호작용을 위한 스타일 추가
    content += `
        <style>
        .faq-question:hover {
            background-color: #f3f4f6;
        }
        
        .faq-hidden {
            display: none;
        }
        </style>
    `;
    
    return content;
}

// 페이지별 특수 기능 초기화
function initializePageSpecificFeatures(page) {
    switch(page) {
        case 'education':
            // URL 파라미터에서 detail 확인 로직은 handleRouter에서 통합 관리함
            setupEducationFilters();
            break;
        case 'apply':
            setupApplyForm();
            break;
        case 'confirm':
            setupConfirmForm();
            break;
        case 'faq':
            setupFaqAccordion();
            break;
    }
}

// 신청 폼 설정
function setupApplyForm() {
    const applyForm = document.getElementById('apply-form');
    if (applyForm) {
        applyForm.addEventListener('submit', handleApplySubmit);
        
        // --- 폼 유형 선택 로직 추가 ---
        const typeBtns = document.querySelectorAll('.form-type-btn');
        const hiddenTypeInput = document.getElementById('apply-form-type');
        const employmentSection = document.getElementById('employment-section');
        const employmentSelect = document.getElementById('apply-employment');
        const companyContainer = document.getElementById('company-input-container');
        const companySuffix = document.getElementById('company-suffix');

        typeBtns.forEach(btn => {
            btn.addEventListener('click', async function() {
                const type = this.getAttribute('data-type');
                
                // 버튼 스타일 업데이트
                typeBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.background = 'white';
                    b.style.color = '#374151';
                    b.style.borderColor = '#e5e7eb';
                });
                this.classList.add('active');
                this.style.background = '#3b82f6';
                this.style.color = 'white';
                this.style.borderColor = '#3b82f6';
                
                hiddenTypeInput.value = type;

                if (type === 'sbs') {
                    // SBS 직원용 신청폼 커스터마이징
                    employmentSection.style.display = 'none';
                    employmentSelect.value = '재직중';
                    companySuffix.innerText = '(SBS 계열사 선택)';
                    
                    // 회사명 드롭다운으로 교체
                    companyContainer.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> 로딩 중...';
                    const companies = await getCompanyData();
                    
                    let selectHtml = '<select id="apply-company" class="form-input" style="cursor: pointer;" required>';
                    selectHtml += '<option value="">회사를 선택해주세요</option>';
                    companies.forEach(company => {
                        selectHtml += `<option value="${company}">${company}</option>`;
                    });
                    selectHtml += '</select>';
                    companyContainer.innerHTML = selectHtml;
                } else {
                    // 일반 신청폼으로 원복
                    employmentSection.style.display = 'block';
                    employmentSelect.value = '';
                    companySuffix.innerText = '(재직중인 경우)';
                    companyContainer.innerHTML = '<input type="text" id="apply-company" class="form-input" placeholder="회사명을 입력해주세요">';
                }
            });
        });
        // -----------------------

        // 과정 선택 시 회차 목록 동적 업데이트 추가
        const courseSelect = document.getElementById('apply-course');
        const roundSelect = document.getElementById('apply-round');
        
        if (courseSelect && roundSelect) {
            courseSelect.addEventListener('change', async function() {
                const selectedTitle = this.value;
                roundSelect.innerHTML = '<option value="">회차를 선택해주세요</option>';
                
                if (!selectedTitle) {
                    roundSelect.disabled = true;
                    return;
                }

                const data = await getEducationData();
                const rounds = data.filter(edu => edu.Title === selectedTitle && (edu.Status === '모집중' || edu.Status === '모집예정'));
                
                if (rounds.length > 0) {
                    rounds.forEach(r => {
                        const option = document.createElement('option');
                        option.value = r.id; 
                        option.textContent = `${r['회차']}회차 (${formatDate(r['Start Date'])} ~ ${formatDate(r['End Date'])})`;
                        if (r.Status === '모집예정') {
                            option.textContent += ' [모집예정]';
                        }
                        option.setAttribute('data-round', r['회차']);
                        option.setAttribute('data-start', r['Start Date']);
                        option.setAttribute('data-end', r['End Date']);
                        roundSelect.appendChild(option);
                    });
                    roundSelect.disabled = false;
                } else {
                    roundSelect.innerHTML = '<option value="">모집 중인 회차가 없습니다</option>';
                    roundSelect.disabled = true;
                }
            });

            // URL의 detail 파라미터가 있으면 해당 과정과 회차를 자동 선택
            const urlParams = getURLParams();
            if (urlParams.page === 'apply' && urlParams.detail) {
                const educationId = urlParams.detail;
                getEducationData().then(data => {
                    const selectedEdu = data.find(item => item.id == educationId);
                    if (selectedEdu) {
                        courseSelect.value = selectedEdu.Title;
                        // change 이벤트를 명시적으로 발생시켜 회차 목록을 불러옴
                        courseSelect.dispatchEvent(new Event('change'));
                        
                        // 회차 목록이 비동기로 로드되므로 약간의 지연 후 회차 ID 선택
                        setTimeout(() => {
                            roundSelect.value = educationId;
                        }, 500);
                    }
                });
            }
        }
    }
}

// 신청 폼 제출 처리
async function handleApplySubmit(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerText;
    
    const courseSelect = document.getElementById('apply-course');
    const roundSelect = document.getElementById('apply-round');
    
    if (!courseSelect.value || !roundSelect.value) {
        alert('교육 과정과 회차를 선택해 주세요.');
        return;
    }

    const selectedRoundOption = roundSelect.options[roundSelect.selectedIndex];
    
    const formData = {
        name: document.getElementById('apply-name').value.trim(),
        email: document.getElementById('apply-email').value.trim(),
        phone: document.getElementById('apply-phone').value.trim(),
        // 과정명 뒤에 회차 정보를 붙여서 전송 (Applications 시트 기록용)
        course: `${courseSelect.value} (${selectedRoundOption.getAttribute('data-round')}회차)`,
        startDate: selectedRoundOption.getAttribute('data-start'),
        endDate: selectedRoundOption.getAttribute('data-end'),
        employment: document.getElementById('apply-employment').value,
        company: document.getElementById('apply-company').value.trim(),
        position: document.getElementById('apply-position').value.trim(),
        agree: document.getElementById('apply-agree').checked,
        formType: document.getElementById('apply-form-type').value
    };
    
    // 필수 항목 검증
    if (!formData.name || !formData.email || !formData.phone || !formData.course || !formData.employment || !formData.position || !formData.agree) {
        alert('모든 필수 항목을 입력하고 동의해 주세요.');
        return;
    }

    // SBS 직원 신청의 경우 회사명 필수 체크
    if (formData.formType === 'sbs' && !formData.company) {
        alert('소속 회사를 선택해 주세요.');
        return;
    }
    
    try {
        // 로딩 상태 표시
        submitBtn.disabled = true;
        submitBtn.innerText = '제출 중...';
        
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`신청이 완료되었습니다!\n\n과정: ${formData.course}\n신청자: ${formData.name}\n`);
            
            // 폼 초기화
            document.getElementById('apply-form').reset();
            // 신청 확인 페이지로 이동
            updateURL('confirm');
        } else {
            throw new Error(result.error || '신청 처리 중 오류가 발생했습니다.');
        }
    } catch (error) {
        console.error("Submission error:", error);
        // 서버에서 온 에러 메시지가 있으면 해당 메시지만 표시하고, 
        // 그렇지 않으면(예: 네트워크 오류 등) 일반 오류 메시지를 표시합니다.
        const errorMsg = error.message.includes('이미') || error.message.includes('확인') 
            ? error.message 
            : '신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n' + error.message;
        alert(errorMsg);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalBtnText;
    }
}

// 신청 확인 폼 설정
function setupConfirmForm() {
    const confirmForm = document.getElementById('confirm-form');
    if (confirmForm) {
        confirmForm.addEventListener('submit', handleConfirmSubmit);
    }
}

// 신청 확인 폼 제출 처리
async function handleConfirmSubmit(event) {
    event.preventDefault();
    
    const name = document.getElementById('confirm-name').value.trim();
    const email = document.getElementById('confirm-email').value.trim();
    
    if (!name || !email) {
        alert('이름과 이메일을 모두 입력해 주세요.');
        return;
    }
    
    const resultDiv = document.getElementById('confirm-result');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    try {
        // 로딩 표시
        submitBtn.disabled = true;
        resultDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div class="spinner" style="display: inline-block; width: 32px; height: 32px; border-width: 3px;"></div>
                <p style="margin-top: 1rem; color: #6b7280;">신청 내역 조회 중...</p>
            </div>
        `;
        
        const response = await fetch(`${API_URL}?type=CheckApplication&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`);
        const data = await response.json();
        
        if (data && data.length > 0) {
            let resultHtml = `
                <div style="margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 1rem;">${name}님의 신청 내역 (${data.length}건)</h3>
                </div>
            `;
            
            data.forEach(app => {
                const date = new Date(app['신청일시']).toLocaleDateString();
                const status = app['처리상태'] || '대기';
                let statusColor = '#6b7280'; // 기본 회색 (대기)
                let statusBg = '#f3f4f6';
                
                if (status === '승인' || status === '완료') {
                    statusColor = '#065f46';
                    statusBg = '#d1fae5';
                } else if (status === '반려' || status === '취소') {
                    statusColor = '#991b1b';
                    statusBg = '#fee2e2';
                }
                
                const showCancelBtn = status === '대기' || status === '승인';
                
                resultHtml += `
                    <div style="background-color: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                            <h4 style="font-weight: 600; color: #111827; font-size: 1rem;">${app['신청과정']}</h4>
                            <span style="background-color: ${statusBg}; color: ${statusColor}; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">${status}</span>
                        </div>
                        <div style="font-size: 14px; color: #6b7280; display: flex; justify-content: space-between; align-items: flex-end;">
                            <div>
                                <p style="margin-bottom: 0.25rem;">교육일자: ${app['Start Date']} ~ ${app['End Date']}</p>
                                <p style="margin-bottom: 0.25rem;">신청일: ${app['신청일시']}</p>
                                <p>이메일: ${app['이메일']}</p>
                            </div>
                            ${showCancelBtn ? `
                            <button onclick="cancelApplication('${app['신청과정']}', '${name}', '${email}')" 
                                style="background-color: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.backgroundColor='#fecaca'" 
                                onmouseout="this.style.backgroundColor='#fee2e2'">
                                신청 취소
                            </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            
            resultDiv.innerHTML = resultHtml;
        } else {
            resultDiv.innerHTML = `
                <div style="background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 1.5rem; color: #991b1b;">
                    <h3 style="font-weight: 600; margin-bottom: 0.5rem;">신청 내역 없음</h3>
                    <p>입력하신 정보로 등록된 신청 내역이 없습니다. 이름과 이메일을 다시 확인해 주세요.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error("Lookup error:", error);
        resultDiv.innerHTML = `
            <div style="background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 1.5rem; color: #991b1b;">
                <p>조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
            </div>
        `;
    } finally {
        submitBtn.disabled = false;
    }
}

// 신청 취소 처리
async function cancelApplication(course, name, email) {
    if (!confirm(`'${course}' 과정을 정말로 취소하시겠습니까?`)) {
        return;
    }

    const cancelReason = prompt('취소 사유를 간단히 입력해 주세요.', '개인 사정으로 인한 취소');
    if (cancelReason === null) return; // 취소 버튼 클릭 시

    showLoadingSpinner();
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                type: 'Cancel',
                course: course,
                name: name,
                email: email,
                cancelReason: cancelReason
            })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message || '취소가 완료되었습니다.');
            // 신청 확인 폼 다시 제출하여 결과 갱신
            document.getElementById('confirm-form').dispatchEvent(new Event('submit'));
        } else {
            throw new Error(result.error || '취소 처리 중 오류가 발생했습니다.');
        }
    } catch (error) {
        console.error("Cancellation error:", error);
        alert(error.message);
    } finally {
        hideLoadingSpinner();
    }
}

// 전역 스코프에 함수 노출
window.cancelApplication = cancelApplication;

// FAQ 아코디언 설정
function setupFaqAccordion() {
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(question => {
        question.addEventListener('click', toggleFaqAnswer);
    });
}

// FAQ 답변 토글
function toggleFaqAnswer(event) {
    const faqIndex = event.currentTarget.getAttribute('data-faq');
    const answer = document.getElementById(`faq-answer-${faqIndex}`);
    const icon = event.currentTarget.querySelector('.faq-icon');
    
    if (answer) {
        if (answer.classList.contains('faq-hidden')) {
            answer.classList.remove('faq-hidden');
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            answer.classList.add('faq-hidden');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }
}

// UI 헬퍼 함수들
function showLoadingSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) {
        spinner.classList.remove('loading-hidden');
        spinner.classList.add('loading-visible');
    }
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) {
        spinner.classList.remove('loading-visible');
        spinner.classList.add('loading-hidden');
    }
}

function showErrorModal(message) {
    const errorModal = document.getElementById('error-modal');
    const errorMessage = document.getElementById('error-message');
    
    if (errorModal && errorMessage) {
        errorMessage.textContent = message;
        errorModal.classList.remove('error-modal-hidden');
        errorModal.classList.add('error-modal-visible');
    }
}

function closeErrorModal() {
    const errorModal = document.getElementById('error-modal');
    if (errorModal) {
        errorModal.classList.remove('error-modal-visible');
        errorModal.classList.add('error-modal-hidden');
    }
}

// 모바일 메뉴 관련 함수들
function toggleMobileMenu() {
    const mobileNav = document.getElementById('mobile-nav');
    if (mobileNav) {
        if (mobileNav.classList.contains('mobile-nav-hidden')) {
            mobileNav.classList.remove('mobile-nav-hidden');
            mobileNav.classList.add('mobile-nav-visible');
        } else {
            mobileNav.classList.remove('mobile-nav-visible');
            mobileNav.classList.add('mobile-nav-hidden');
        }
    }
}

function closeMobileMenu() {
    const mobileNav = document.getElementById('mobile-nav');
    if (mobileNav) {
        mobileNav.classList.remove('mobile-nav-visible');
        mobileNav.classList.add('mobile-nav-hidden');
    }
}

function handleOutsideClick(event) {
    const mobileNav = document.getElementById('mobile-nav');
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    
    if (mobileNav && !mobileNav.contains(event.target) && !mobileMenuToggle.contains(event.target)) {
        closeMobileMenu();
    }
}

// 교육 상세 모달 열기
async function openEducationModal(educationId) {
    // 기존에 열려있는 모달이 있다면 즉시 제거하여 중복 방지
    const existingModal = document.getElementById('education-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const rawData = await getEducationData();
    const groupedData = getGroupedEducationData(rawData);
    
    // educationId가 그룹 내 어떤 아이템의 ID라도 해당 그룹을 찾음
    const education = groupedData.find(group => group.rounds.some(r => r.id == educationId));
    if (!education) return;
    
    // URL 업데이트
    updateURL('education', educationId);

    const modalHTML = `
        <div id="education-modal" class="education-modal">
            <div class="education-modal-backdrop" onclick="closeEducationModal()"></div>
            <div class="education-modal-content">
                <div class="education-modal-header">
                    <div style="flex: 1;">
                        <h2 style="margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: bold; color: #1f2937;">${education.Title}</h2>
                        <!--<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            <span style="background: #dbeafe; color: #1e40af; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem;">${education.Category}</span>
                        </div>-->
                    </div>
                    <button onclick="closeEducationModal()" style="background: none; border: none; font-size: 1.5rem; color: #6b7280; cursor: pointer; padding: 0.5rem;">×</button>
                </div>
                
                <div class="education-modal-body">
                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.5rem;">교육 개요</h3>
                        <p style="padding: 1rem; background: #f8fafc; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Description) || '설명이 없습니다.'}</p>
                    </div>
                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">학습목표 및 혜택</h3>
                        <div style="padding: 1rem; background: #f8fafc; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Benefits) || '등록된 혜택이 없습니다.'}</div>
                    </div>
                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">커리큘럼</h3>
                        <div style="padding: 1rem; background: #f8fafc; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Curriculum) || '등록된 커리큘럼이 없습니다.'}</div>
                    </div>
                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">강사</h3>
                        <div style="padding: 1rem; background: #eef5fdff; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Instructor) || '미정'}</div>
                    </div>

                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">지원 대상 및 조건</h3>
                        <div style="padding: 1rem; background: #fffefed; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Requirements) || '특별한 수강 요건이 없습니다.'}</div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="margin-bottom: 2rem;">
                            <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">수강료</h3>
                            <div style="padding: 1rem; background: #f8fafc; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Price) || '무료'}</div>
                        </div>
                        <div style="margin-bottom: 2rem;">
                            <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">장소</h3>
                            <div style="padding: 1rem; background: #f8fafc; border-radius: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${parseMarkdown(education.Location) || '미정'}</div>
                        </div>
                    </div>
                    
                    <!-- 회차 정보 섹션 추가 -->
                    <div style="margin-bottom: 2rem;">
                        <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">교육 일정 (회차 선택)</h3>
                        <div style="background: #f8fafc; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;">
                            ${education.rounds.map((r, idx) => `
                                <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; ${idx < education.rounds.length - 1 ? 'border-bottom: 1px solid #e5e7eb;' : ''}">
                                    <div style="flex: 1;">
                                        <span style="font-weight: 600; color: #1f2937; margin-right: 0.5rem;">${r.round}회차</span>
                                        <span style="color: #6b7280; font-size: 0.875rem;">${formatDate(r.startDate)} ~ ${formatDate(r.endDate)}</span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                                        <span style="font-size: 0.75rem; font-weight: 600; color: ${getStatusColor(r.status)};">
                                            ${r.status}
                                        </span>
                                        ${(r.status === '모집중') ? `
                                            <button onclick="applyEducation('${r.id}')" style="background: #3b82f6; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">신청</button>
                                        ` : `
                                            <button disabled style="background: #e5e7eb; color: #9ca3af; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; cursor: not-allowed;">불가</button>
                                        `}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div class="education-modal-footer">
                    <button onclick="closeEducationModal()" style="background: #f3f4f6; color: #374151; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 500; cursor: pointer; margin-right: 1rem;">
                        닫기
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // 애니메이션을 위해 약간 지연 후 active 클래스 추가
    setTimeout(() => {
        const modal = document.getElementById('education-modal');
        if (modal) {
            modal.classList.add('active');
        }
    }, 10);
}

// 교육 신청하기 버튼 클릭 처리
function applyEducation(educationId) {
    // 모달을 닫되 URL 업데이트는 하지 않음 (바로 다음 updateURL에서 처리할 것이므로)
    closeEducationModal(false);
    
    // 신청 페이지로 상세 ID와 함께 이동
    updateURL('apply', educationId);
}

// 교육 상세 모달 닫기
function closeEducationModal(shouldUpdateURL = true) {
    const modal = document.getElementById('education-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
        }, 300);
        
        // URL에서 detail 파라미터 제거
        if (shouldUpdateURL) {
            updateURL('education');
        }
    }
}

// 현재 페이지 가져오기
function getCurrentPage() {
    const activeNav = document.querySelector('.nav-item.active, .mobile-nav-item.active');
    return activeNav ? activeNav.getAttribute('data-page') : 'home';
}

// 개인정보처리방침 페이지 렌더링
function renderPrivacyPage() {
    return `
        <div class="content-card">
            <h1 style="font-size: 1.875rem; font-weight: bold; color: #1f2937; margin-bottom: 1.5rem;">개인정보처리방침</h1>
            <div style="color: #374151; line-height: 1.7; font-size: 0.95rem;">
                <p>SBSA&T(이하 '운영자')는 이용자의 개인정보를 보호하고 관련 법령을 준수하기 위해 다음과 같은 처리방침을 두고 있습니다.</p>
                
                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">1. 수집하는 개인정보 항목</h3>
                <p>운영자는 교육 신청 및 상담을 위해 아래와 같은 개인정보를 수집하고 있습니다.</p>
                <ul style="margin-bottom: 1rem; padding-left: 1.5rem;">
                    <li>필수항목: 이름, 이메일, 연락처, 희망 교육 과정, 직군/직급</li>
                    <li>선택항목: 재직여부, 회사명</li>
                </ul>

                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">2. 개인정보의 수집 및 이용 목적</h3>
                <p>수집된 개인정보는 다음의 목적을 위해 활용됩니다.</p>
                <ul style="margin-bottom: 1rem; padding-left: 1.5rem;">
                    <li>교육 과정 신청 접수 및 수강생 선발</li>
                    <li>교육 관련 안내 사항 전달 (이메일, 문자 등)</li>
                    <li>신규 교육 과정 안내 및 만족도 조사</li>
                    <li>고용노동부 등 관계 기관의 훈련생 관리 및 보고</li>
                </ul>

                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">3. 개인정보의 보유 및 이용 기간</h3>
                <p>운영자는 원칙적으로 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 관계법령의 규정에 의하여 보존할 필요가 있는 경우 아래와 같이 일정 기간 보관합니다.</p>
                <ul style="margin-bottom: 1rem; padding-left: 1.5rem;">
                    <li>교육 신청 및 관리 기록: 교육 종료 후 3년</li>
                    <li>소비자의 불만 또는 분쟁처리에 관한 기록: 3년</li>
                </ul>

                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">4. 개인정보의 파기절차 및 방법</h3>
                <p>개인정보의 파기는 목적이 달성된 개인정보를 전자적 파일 형태의 경우 복구가 불가능한 방법으로 영구 삭제하며, 출력물 등은 분쇄하거나 소각하여 파기합니다.</p>

                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">5. 이용자의 권리와 그 행사방법</h3>
                <p>이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나 수정할 수 있으며 가입해지(동의철회)를 요청할 수 있습니다.</p>

                <h3 style="font-size: 1.15rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem;">6. 개인정보 보호책임자</h3>
                <p>이용자의 개인정보를 보호하고 관련 불만을 처리하기 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
                <p style="background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                    이름: 이종헌<br>
                    이메일: haba@sbs.co.kr<br>
                </p>
                <!--<p style="margin-top: 2rem; font-size: 0.85rem; color: #6b7280;">본 방침은 2026년 1월 14일부터 시행됩니다.</p>-->
            </div>
        </div>
    `;
}

// 개인정보처리방침 모달 열기
function openPrivacyModal() {
    const content = renderPrivacyPage();
    const modalHTML = `
        <div id="privacy-modal" class="education-modal">
            <div class="education-modal-backdrop" onclick="closePrivacyModal()"></div>
            <div class="education-modal-content" style="max-width: 800px; margin: 2rem auto; border-radius: 12px; height: auto; max-height: 80vh;">
                <div class="education-modal-header">
                    <h2 style="margin: 0; font-size: 1.5rem;">개인정보 처리 안내</h2>
                    <button onclick="closePrivacyModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
                </div>
                <div class="education-modal-body" style="padding: 2rem; overflow-y: auto;">
                    ${content}
                </div>
                <div class="education-modal-footer">
                    <button onclick="closePrivacyModal()" class="btn-primary">닫기</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => {
        const modal = document.getElementById('privacy-modal');
        if (modal) modal.classList.add('active');
    }, 10);
}

// 개인정보처리방침 모달 닫기
function closePrivacyModal() {
    const modal = document.getElementById('privacy-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}
