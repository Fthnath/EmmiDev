 // API Key for OpenWeatherMap - Replace with your actual key
        const API_KEY = '05f1751b78f7a309da274a2f935980cf';
        
        // DOM Elements
        const citySearch = document.getElementById('citySearch');
        const searchBtn = document.getElementById('searchBtn');
        const weatherCards = document.getElementById('weatherCards');
        const forecastContainer = document.getElementById('forecastContainer');
        const weatherLoader = document.getElementById('weatherLoader');
        const forecastLoader = document.getElementById('forecastLoader');
        const weatherError = document.getElementById('weatherError');
        const forecastError = document.getElementById('forecastError');
        const lifestyleCards = document.getElementById('lifestyleCards');
        const healthCards = document.getElementById('healthCards');
        const alertCards = document.getElementById('alertCards');
        const premiumLink = document.getElementById('premium-link');
        const premiumFooterLink = document.getElementById('premium-footer-link');
        const premiumPopup = document.getElementById('premiumPopup');
        const closePopup = document.getElementById('closePopup');
        
        let currentWeatherData = null;
        let humidityChart = null;

        // Initialize the app with user's location
        window.addEventListener('load', () => {
            // Show loading state
            weatherLoader.style.display = 'block';
            
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    position => {
                        const { latitude, longitude } = position.coords;
                        getWeatherByCoords(latitude, longitude);
                    },
                    error => {
                        // Default to London if location access is denied or fails
                        weatherError.textContent = 'Location access denied. Showing weather for London.';
                        weatherError.style.display = 'block';
                        getWeatherData('London');
                    },
                    { timeout: 10000 } // 10 second timeout
                );
            } else {
                // Geolocation not supported
                weatherError.textContent = 'Geolocation not supported. Showing weather for London.';
                weatherError.style.display = 'block';
                getWeatherData('London');
            }
        });

        // Premium popup functionality
        premiumLink.addEventListener('click', (e) => {
            e.preventDefault();
            premiumPopup.style.display = 'flex';
        });

        premiumFooterLink.addEventListener('click', (e) => {
            e.preventDefault();
            premiumPopup.style.display = 'flex';
        });

        closePopup.addEventListener('click', () => {
            premiumPopup.style.display = 'none';
        });

        // Close popup when clicking outside
        premiumPopup.addEventListener('click', (e) => {
            if (e.target === premiumPopup) {
                premiumPopup.style.display = 'none';
            }
        });

        // Search button event listener
        searchBtn.addEventListener('click', () => {
            const city = citySearch.value.trim();
            if (city) {
                getWeatherData(city);
            }
        });

        // Enter key event listener for search
        citySearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const city = citySearch.value.trim();
                if (city) {
                    getWeatherData(city);
                }
            }
        });

        // Get weather by coordinates
        async function getWeatherByCoords(lat, lon) {
            try {
                const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
                if (!response.ok) throw new Error('Location not found');
                
                const data = await response.json();
                getWeatherData(data.name);
            } catch (error) {
                weatherError.textContent = 'Failed to get location data. Showing weather for London.';
                weatherError.style.display = 'block';
                getWeatherData('London');
            }
        }

        // Fetch weather data from API
        async function getWeatherData(city) {
            // Show loaders and hide errors
            weatherLoader.style.display = 'block';
            forecastLoader.style.display = 'block';
            weatherError.style.display = 'none';
            forecastError.style.display = 'none';
            
            try {
                // Fetch current weather
                const currentWeatherResponse = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`);
                
                if (!currentWeatherResponse.ok) {
                    throw new Error('City not found');
                }
                
                const currentWeather = await currentWeatherResponse.json();
                currentWeatherData = currentWeather;
                
                // Fetch 5-day forecast
                const forecastResponse = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${API_KEY}&units=metric`);
                if (!forecastResponse.ok) {
                    throw new Error('Forecast data unavailable');
                }
                const forecastData = await forecastResponse.json();
                
                // Update UI with weather data
                displayCurrentWeather(currentWeather);
                displayForecast(forecastData);
                updateHumidityChart(forecastData);
                
                // Update lifestyle and health sections
                updateLifestyleSection(currentWeather);
                updateHealthSection(currentWeather);
                updateHealthAlerts(currentWeather);
                
                // Update animation based on weather
                updateAnimation(currentWeather.weather[0].main);
                
            } catch (error) {
                weatherError.textContent = error.message;
                weatherError.style.display = 'block';
                forecastError.textContent = error.message;
                forecastError.style.display = 'block';
            } finally {
                weatherLoader.style.display = 'none';
                forecastLoader.style.display = 'none';
            }
        }

        // Display current weather data
        function displayCurrentWeather(data) {
            const weatherIcon = getWeatherIcon(data.weather[0].main);
            const date = new Date(data.dt * 1000);
            
            weatherCards.innerHTML = `
                <div class="weather-card">
                    <div class="card-header">
                        <h3>${data.name}, ${data.sys.country}</h3>
                        <p>${date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                    <div class="card-body">
                        <div class="weather-icon">
                            <i class="${weatherIcon}"></i>
                        </div>
                        <div class="temp">${Math.round(data.main.temp)}°C</div>
                        <div class="weather-desc">${data.weather[0].description}</div>
                        <div class="weather-details">
                            <div class="detail-item">
                                <i class="fas fa-wind"></i>
                                <span>${data.wind.speed} m/s</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-tint"></i>
                                <span>${data.main.humidity}%</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-eye"></i>
                                <span>${data.visibility / 1000} km</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-compress-alt"></i>
                                <span>${data.main.pressure} hPa</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Display 5-day forecast
        function displayForecast(data) {
            // Filter to get one forecast per day
            const dailyForecasts = {};
            data.list.forEach(item => {
                const date = item.dt_txt.split(' ')[0];
                if (!dailyForecasts[date]) {
                    dailyForecasts[date] = item;
                }
            });
            
            // Convert to array and remove today
            const forecastArray = Object.values(dailyForecasts);
            forecastArray.shift();
            
            forecastContainer.innerHTML = '';
            
            forecastArray.forEach(day => {
                const date = new Date(day.dt * 1000);
                const weatherIcon = getWeatherIcon(day.weather[0].main);
                
                const forecastItem = document.createElement('div');
                forecastItem.classList.add('forecast-item');
                forecastItem.innerHTML = `
                    <div class="forecast-day">${date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div class="forecast-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    <div class="forecast-icon">
                        <i class="${weatherIcon}"></i>
                    </div>
                    <div class="forecast-temp">${Math.round(day.main.temp)}°C</div>
                    <div class="forecast-desc">${day.weather[0].description}</div>
                `;
                
                forecastContainer.appendChild(forecastItem);
            });
        }

        // Update humidity chart
        function updateHumidityChart(forecastData) {
            const ctx = document.getElementById('humidityChart').getContext('2d');
            
            // Get next 24 hours of data (8 data points as we have 3-hour intervals)
            const hourlyData = forecastData.list.slice(0, 8);
            const labels = hourlyData.map(item => {
                const date = new Date(item.dt * 1000);
                return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
            });
            const humidityData = hourlyData.map(item => item.main.humidity);
            
            // Destroy previous chart if it exists
            if (humidityChart) {
                humidityChart.destroy();
            }
            
            // Create new chart
            humidityChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Humidity (%)',
                        data: humidityData,
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 2,
                        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                        pointRadius: 4,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: '24-Hour Humidity Forecast',
                            font: {
                                size: 16
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            min: Math.max(0, Math.min(...humidityData) - 10),
                            max: Math.min(100, Math.max(...humidityData) + 10),
                            title: {
                                display: true,
                                text: 'Humidity (%)'
                            }
                        }
                    }
                }
            });
        }

        // Update lifestyle section based on weather data
        function updateLifestyleSection(weatherData) {
            const temp = weatherData.main.temp;
            const condition = weatherData.weather[0].main;
            const humidity = weatherData.main.humidity;
            
            let activityRecommendation = '';
            let clothingRecommendation = '';
            let foodRecommendation = '';
            
            // Activity recommendations based on temperature and conditions
            if (temp > 30) {
                activityRecommendation = 'It\'s hot outside! Perfect for swimming or water activities. Avoid strenuous exercises during peak sun hours.';
            } else if (temp > 20) {
                activityRecommendation = 'Great weather for outdoor activities! Consider hiking, cycling, or a picnic in the park.';
            } else if (temp > 10) {
                activityRecommendation = 'Pleasant weather for walking, jogging, or outdoor sports. Dress in layers for comfort.';
            } else {
                activityRecommendation = 'Chilly outside. Good for brisk walks or indoor activities. Consider visiting museums or indoor sports.';
            }
            
            // Clothing recommendations
            if (temp > 25) {
                clothingRecommendation = 'Lightweight and light-colored clothing. Wear a hat and sunglasses for sun protection.';
            } else if (temp > 15) {
                clothingRecommendation = 'Light layers. A t-shirt with a light jacket or sweater for cooler moments.';
            } else if (temp > 5) {
                clothingRecommendation = 'Warm layers. Wear a sweater or jacket, and consider a scarf for extra warmth.';
            } else {
                clothingRecommendation = 'Bundle up! Wear a heavy coat, hat, gloves, and scarf to stay warm.';
            }
            
            // Food recommendations
            if (temp > 25) {
                foodRecommendation = 'Stay hydrated with plenty of water. Enjoy light meals like salads, fruits, and cold dishes.';
            } else if (temp > 15) {
                foodRecommendation = 'Perfect for grilled foods, fresh vegetables, and refreshing beverages.';
            } else if (temp > 5) {
                foodRecommendation = 'Comfort foods like soups, stews, and warm beverages are ideal.';
            } else {
                foodRecommendation = 'Hot meals and warm drinks will help you stay warm. Think hearty soups and hot chocolate.';
            }
            
            // Adjust for rain
            if (condition === 'Rain') {
                activityRecommendation = 'Rainy weather. Perfect for indoor activities, reading, or visiting cafes. Carry an umbrella if going out.';
                clothingRecommendation = 'Waterproof jacket or umbrella is essential. Wear waterproof shoes to stay dry.';
            }
            
            // Update lifestyle cards
            lifestyleCards.innerHTML = `
                <div class="recommendation-card">
                    <div class="recommendation-icon">
                        <i class="fas fa-running"></i>
                    </div>
                    <h3 class="recommendation-title">Outdoor Activities</h3>
                    <p class="recommendation-desc">${activityRecommendation}</p>
                    
                    <div class="recommendation-details">
                        <h4>Recommended Activities:</h4>
                        <ul>
                            <li>${temp > 20 ? 'Outdoor sports' : 'Indoor activities'}</li>
                            <li>${temp > 25 ? 'Swimming' : 'Walking or hiking'}</li>
                            <li>${condition === 'Rain' ? 'Visit museums' : 'Park activities'}</li>
                            <li>${temp > 15 ? 'Picnics' : 'Coffee shop visits'}</li>
                        </ul>
                    </div>
                </div>
                
                <div class="recommendation-card">
                    <div class="recommendation-icon">
                        <i class="fas fa-tshirt"></i>
                    </div>
                    <h3 class="recommendation-title">Clothing Advice</h3>
                    <p class="recommendation-desc">${clothingRecommendation}</p>
                    
                    <div class="recommendation-details">
                        <h4>Recommended Attire:</h4>
                        <ul>
                            <li>${temp > 20 ? 'Light breathable fabrics' : 'Warm layers'}</li>
                            <li>${condition === 'Rain' ? 'Waterproof jacket' : 'Regular jacket'}</li>
                            <li>${temp > 25 ? 'Sunglasses and hat' : 'Comfortable shoes'}</li>
                            <li>${temp < 10 ? 'Scarf and gloves' : 'Light accessories'}</li>
                        </ul>
                    </div>
                </div>
                
                <div class="recommendation-card">
                    <div class="recommendation-icon">
                        <i class="fas fa-utensils"></i>
                    </div>
                    <h3 class="recommendation-title">Food & Nutrition</h3>
                    <p class="recommendation-desc">${foodRecommendation}</p>
                    
                    <div class="recommendation-details">
                        <h4>Dietary Suggestions:</h4>
                        <ul>
                            <li>${temp > 20 ? 'Increase water intake' : 'Warm beverages'}</li>
                            <li>${temp > 20 ? 'Fresh salads and fruits' : 'Hearty soups and stews'}</li>
                            <li>${temp > 15 ? 'Light grilled proteins' : 'Comfort foods'}</li>
                            <li>${temp > 25 ? 'Cold beverages and smoothies' : 'Hot meals'}</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        // Update health section based on weather data
        function updateHealthSection(weatherData) {
            const temp = weatherData.main.temp;
            const humidity = weatherData.main.humidity;
            const condition = weatherData.weather[0].main;
            
            // Calculate UV index based on temperature and conditions (simplified)
            let uvIndex = Math.min(11, Math.max(1, Math.round(temp / 3)));
            if (condition === 'Clouds') uvIndex = Math.max(1, uvIndex - 2);
            if (condition === 'Rain') uvIndex = Math.max(1, uvIndex - 3);
            
            // Calculate air quality based on humidity and conditions (simplified)
            let aqi = 50 - Math.abs(50 - humidity);
            if (condition === 'Clear') aqi += 10;
            if (condition === 'Rain') aqi += 15;
            
            // Determine pollen level based on conditions (simplified)
            let pollenLevel = 'Low';
            if (condition === 'Clear' && temp > 15) pollenLevel = 'High';
            else if (condition === 'Clear') pollenLevel = 'Medium';
            
            // Update health cards
            healthCards.innerHTML = `
                <div class="health-card">
                    <div class="health-icon">
                        <i class="fas fa-lungs"></i>
                    </div>
                    <h3 class="health-title">Air Quality</h3>
                    <p class="health-desc">Current air pollution levels and health implications</p>
                    
                    <div class="health-metrics">
                        <div class="metric">
                            <div class="metric-value">${aqi}</div>
                            <div class="metric-label">AQI</div>
                        </div>
                        <div class="metric">
                            <div class="metric-value">${aqi < 50 ? 'Good' : aqi < 100 ? 'Moderate' : 'Poor'}</div>
                            <div class="metric-label">Air Quality</div>
                        </div>
                    </div>
                    
                    <div class="health-tips">
                        <h4>Health Recommendations:</h4>
                        <ul>
                            <li>${aqi < 50 ? 'Ideal air quality for outdoor activities' : 'Consider reducing prolonged outdoor exertion'}</li>
                            <li>${aqi > 100 ? 'Sensitive groups should limit outdoor exposure' : 'No need for masks for most people'}</li>
                            <li>Good ventilation recommended indoors</li>
                        </ul>
                    </div>
                </div>
                
                <div class="health-card">
                    <div class="health-icon">
                        <i class="fas fa-sun"></i>
                    </div>
                    <h3 class="health-title">UV Index</h3>
                    <p class="health-desc">Sun protection needed for today's conditions</p>
                    
                    <div class="health-metrics">
                        <div class="metric">
                            <div class="metric-value">${uvIndex}</div>
                            <div class="metric-label">UV Index</div>
                        </div>
                        <div class="metric">
                            <div class="metric-value">${uvIndex < 3 ? 'Low' : uvIndex < 6 ? 'Moderate' : uvIndex < 8 ? 'High' : 'Very High'}</div>
                            <div class="metric-label">Risk Level</div>
                        </div>
                    </div>
                    
                    <div class="health-tips">
                        <h4>Protection Advice:</h4>
                        <ul>
                            <li>${uvIndex > 3 ? 'Apply SPF 30+ sunscreen' : 'Sunscreen not essential but recommended'}</li>
                            <li>${uvIndex > 6 ? 'Wear protective clothing and hat' : 'Light protection recommended'}</li>
                            <li>${uvIndex > 8 ? 'Seek shade during midday hours' : 'Limit sun exposure during peak hours'}</li>
                            <li>Wear UV-blocking sunglasses</li>
                        </ul>
                    </div>
                </div>
                
                <div class="health-card">
                    <div class="health-icon">
                        <i class="fas fa-allergies"></i>
                    </div>
                    <h3 class="health-title">Pollen Count</h3>
                    <p class="health-desc">Current allergen levels and recommendations</p>
                    
                    <div class="health-metrics">
                        <div class="metric">
                            <div class="metric-value">${pollenLevel}</div>
                            <div class="metric-label">Pollen Level</div>
                        </div>
                        <div class="metric">
                            <div class="metric-value">${condition === 'Clear' ? 'Grass' : 'Mold'}</div>
                            <div class="metric-label">Primary Allergen</div>
                        </div>
                    </div>
                    
                    <div class="health-tips">
                        <h4>For Allergy Sufferers:</h4>
                        <ul>
                            <li>${pollenLevel === 'High' ? 'Keep windows closed during daytime' : 'Ventilation is generally safe'}</li>
                            <li>${pollenLevel === 'High' ? 'Use air purifiers indoors' : 'Normal air circulation is fine'}</li>
                            <li>Shower after outdoor activities</li>
                            <li>${pollenLevel === 'High' ? 'Consider antihistamines if symptomatic' : 'Medication likely not needed'}</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        // Update health alerts based on weather data
        function updateHealthAlerts(weatherData) {
            const temp = weatherData.main.temp;
            const condition = weatherData.weather[0].main;
            const humidity = weatherData.main.humidity;
            
            alertCards.innerHTML = '';
            
            // Heat warning
            if (temp > 30) {
                alertCards.innerHTML += `
                    <div class="alert-card warning">
                        <div class="alert-icon">
                            <i class="fas fa-temperature-high"></i>
                        </div>
                        <div class="alert-content">
                            <h4>Heat Advisory</h4>
                            <p>High temperatures expected today. Stay hydrated and avoid prolonged sun exposure.</p>
                        </div>
                    </div>
                `;
            }
            
            // Cold warning
            if (temp < 5) {
                alertCards.innerHTML += `
                    <div class="alert-card info">
                        <div class="alert-icon">
                            <i class="fas fa-snowflake"></i>
                        </div>
                        <div class="alert-content">
                            <h4>Cold Weather Alert</h4>
                            <p>Temperature dropping. Dress warmly in layers if going outside.</p>
                        </div>
                    </div>
                `;
            }
            
            // Rain warning
            if (condition === 'Rain') {
                alertCards.innerHTML += `
                    <div class="alert-card info">
                        <div class="alert-icon">
                            <i class="fas fa-cloud-rain"></i>
                        </div>
                        <div class="alert-content">
                            <h4>Rain Alert</h4>
                            <p>Rain expected today. Carry an umbrella and wear waterproof clothing.</p>
                        </div>
                    </div>
                `;
            }
            
            // High humidity warning
            if (humidity > 80) {
                alertCards.innerHTML += `
                    <div class="alert-card info">
                        <div class="alert-icon">
                            <i class="fas fa-tint"></i>
                        </div>
                        <div class="alert-content">
                            <h4>High Humidity</h4>
                            <p>High humidity levels today. Stay hydrated and take breaks in air-conditioned spaces.</p>
                        </div>
                    </div>
                `;
            }
            
            // Default alert if no specific warnings
            if (alertCards.innerHTML === '') {
                alertCards.innerHTML = `
                    <div class="alert-card info">
                        <div class="alert-icon">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div class="alert-content">
                            <h4>No Major Alerts</h4>
                            <p>No significant health alerts for today. Enjoy the weather!</p>
                        </div>
                    </div>
                `;
            }
        }

        // Get appropriate weather icon
        function getWeatherIcon(weatherMain) {
            switch(weatherMain.toLowerCase()) {
                case 'clear':
                    return 'fas fa-sun';
                case 'clouds':
                    return 'fas fa-cloud';
                case 'rain':
                    return 'fas fa-cloud-rain';
                case 'snow':
                    return 'fas fa-snowflake';
                case 'thunderstorm':
                    return 'fas fa-bolt';
                case 'drizzle':
                    return 'fas fa-cloud-rain';
                case 'mist':
                case 'smoke':
                case 'haze':
                case 'dust':
                case 'fog':
                case 'sand':
                case 'ash':
                case 'squall':
                case 'tornado':
                    return 'fas fa-smog';
                default:
                    return 'fas fa-cloud';
            }
        }

        // Canvas animation for the header
        function initAnimation() {
            const canvas = document.getElementById('weatherAnimation');
            const ctx = canvas.getContext('2d');
            
            // Set canvas size to window size
            canvas.width = window.innerWidth;
            canvas.height = 500;
            
            // Animation variables
            let clouds = [];
            let sunX = canvas.width * 0.8;
            let sunY = canvas.height * 0.7;
            let frameCount = 0;
            let isRaining = false;
            let isSunny = true;
            
            // Create clouds
            for (let i = 0; i < 5; i++) {
                clouds.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height * 0.5,
                    radius: 30 + Math.random() * 40,
                    speed: 0.5 + Math.random() * 1.5
                });
            }
            
            // Draw sun with rays
            function drawSun(x, y, radius) {
                // Sun rays
                ctx.save();
                ctx.translate(x, y);
                for (let i = 0; i < 12; i++) {
                    ctx.rotate(Math.PI / 6);
                    ctx.beginPath();
                    ctx.moveTo(radius * 1.3, 0);
                    ctx.lineTo(radius * 1.7, 0);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
                ctx.restore();
                
                // Sun body
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                                gradient.addColorStop(1, 'rgba(255, 215, 0, 0.5)');
                ctx.fillStyle = gradient;
                ctx.fill();
            }
            
            // Draw cloud
            function drawCloud(x, y, radius) {
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.arc(x + radius * 0.8, y - radius * 0.5, radius * 0.8, 0, Math.PI * 2);
                ctx.arc(x + radius * 1.6, y, radius, 0, Math.PI * 2);
                ctx.arc(x + radius * 1.2, y + radius * 0.5, radius * 0.9, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.fill();
            }
            
            // Draw rain
            function drawRain() {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.lineWidth = 2;
                
                for (let i = 0; i < 100; i++) {
                    const x = Math.random() * canvas.width;
                    const y = Math.random() * canvas.height;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + 2, y + 10);
                    ctx.stroke();
                }
            }
            
            // Draw person with umbrella
            function drawPersonWithUmbrella(x, y) {
                // Umbrella
                ctx.beginPath();
                ctx.arc(x, y - 20, 25, Math.PI, Math.PI * 2, false);
                ctx.fillStyle = '#ff6b01';
                ctx.fill();
                
                ctx.beginPath();
                ctx.moveTo(x - 25, y - 20);
                ctx.lineTo(x + 25, y - 20);
                ctx.strokeStyle = '#ff6b01';
                ctx.lineWidth = 3;
                ctx.stroke();
                
                // Umbrella handle
                ctx.beginPath();
                ctx.moveTo(x, y - 20);
                ctx.lineTo(x, y);
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                // Person body
                ctx.beginPath();
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.fillStyle = '#333';
                ctx.fill();
                
                // Body
                ctx.beginPath();
                ctx.moveTo(x, y + 10);
                ctx.lineTo(x, y + 30);
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 3;
                ctx.stroke();
                
                // Legs
                ctx.beginPath();
                ctx.moveTo(x, y + 30);
                ctx.lineTo(x - 10, y + 40);
                ctx.moveTo(x, y + 30);
                ctx.lineTo(x + 10, y + 40);
                ctx.stroke();
            }
            
            // Draw person with headphones
            function drawPersonWithHeadphones(x, y) {
                // Headphones
                ctx.beginPath();
                ctx.arc(x - 8, y - 5, 5, 0, Math.PI * 2);
                ctx.arc(x + 8, y - 5, 5, 0, Math.PI * 2);
                ctx.moveTo(x - 13, y - 5);
                ctx.lineTo(x + 13, y - 5);
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                // Person head
                ctx.beginPath();
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.fillStyle = '#333';
                ctx.fill();
                
                // Body
                ctx.beginPath();
                ctx.moveTo(x, y + 10);
                ctx.lineTo(x, y + 30);
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 3;
                ctx.stroke();
                
                // Arms
                ctx.beginPath();
                ctx.moveTo(x, y + 15);
                ctx.lineTo(x + 15, y + 20);
                ctx.stroke();
                
                // Legs
                ctx.beginPath();
                ctx.moveTo(x, y + 30);
                ctx.lineTo(x - 10, y + 40);
                ctx.moveTo(x, y + 30);
                ctx.lineTo(x + 10, y + 40);
                ctx.stroke();
            }
            
            // Animation loop
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Background gradient based on weather
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                if (isRaining) {
                    gradient.addColorStop(0, '#2c3e50');
                    gradient.addColorStop(1, '#3498db');
                } else if (!isSunny) {
                    gradient.addColorStop(0, '#636363');
                    gradient.addColorStop(1, '#a2abbb');
                } else {
                    gradient.addColorStop(0, '#1a2980');
                    gradient.addColorStop(1, '#26d0ce');
                }
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw sun
                if (isSunny && !isRaining) {
                    drawSun(sunX, sunY, 40);
                    sunY -= 0.1;
                    if (sunY < canvas.height * 0.3) sunY = canvas.height * 0.3;
                }
                
                // Update and draw clouds
                clouds.forEach(cloud => {
                    cloud.x += cloud.speed;
                    if (cloud.x > canvas.width + cloud.radius * 2) {
                        cloud.x = -cloud.radius * 2;
                    }
                    drawCloud(cloud.x, cloud.y, cloud.radius);
                });
                
                // Draw rain if raining
                if (isRaining) {
                    drawRain();
                    
                    // Draw person with umbrella
                    const personX = (frameCount / 3) % (canvas.width + 100) - 50;
                    drawPersonWithUmbrella(personX, canvas.height * 0.8);
                } else {
                    // Draw person with headphones
                    const personX = (frameCount / 3) % (canvas.width + 100) - 50;
                    drawPersonWithHeadphones(personX, canvas.height * 0.8);
                }
                
                frameCount++;
                
                requestAnimationFrame(animate);
            }
            
            // Start animation
            animate();
            
            // Resize event
            window.addEventListener('resize', function() {
                canvas.width = window.innerWidth;
                canvas.height = 500;
            });
            
            // Return function to update animation based on weather
            return function(weatherType) {
                isRaining = weatherType.toLowerCase() === 'rain';
                isSunny = weatherType.toLowerCase() === 'clear';
            };
        }

        // Initialize animation and get update function
        const updateAnimation = initAnimation();

        // Form submission
        document.getElementById('contactForm').addEventListener('submit', function(e) {
            e.preventDefault();
            alert('Thank you for your message! We will get back to you soon.');
            this.reset();
        });

        // Smooth scrolling for navigation
        document.querySelectorAll('nav a').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                if (targetId.startsWith('#')) {
                    const targetElement = document.querySelector(targetId);
                    
                    window.scrollTo({
                        top: targetElement.offsetTop - 100,
                        behavior: 'smooth'
                    });
                }
            });
        });
