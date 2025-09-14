// This is a new comment to trigger a re-deployment.
const fetch = require('node-fetch');

// --- Secure Credentials from Environment Variables ---
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=" + GEMINI_API_KEY;

let auth0Token = '';
let tokenExpiry = 0;

// --- Backend API Logic (The "Agent") ---

/**
 * Retrieves a fresh Auth0 Management API access token.
 * It uses a caching mechanism to avoid unnecessary API calls.
 */
const getAuth0Token = async () => {
    const now = Date.now();
    console.log("Checking for cached token...");
    if (auth0Token && tokenExpiry > now) {
        console.log("Using cached Auth0 token.");
        return auth0Token;
    }
    console.log("Cached token is expired or not present. Requesting a new one.");

    const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
    const payload = {
        client_id: AUTH0_CLIENT_ID,
        client_secret: AUTH0_CLIENT_SECRET,
        audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        grant_type: 'client_credentials'
    };

    try {
        console.log(`Attempting to retrieve Auth0 token from: ${tokenUrl}`);
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log(`Auth0 token response status: ${response.status}`);
        
        const responseText = await response.text();
        console.log(`Auth0 token raw response: ${responseText}`);

        if (!response.ok) {
            throw new Error(`Auth0 token retrieval failed with status: ${response.status}. Response: ${responseText}`);
        }

        const data = JSON.parse(responseText);
        auth0Token = data.access_token;
        tokenExpiry = now + (data.expires_in - 300) * 1000;
        console.log("Successfully retrieved new Auth0 token.");
        return auth0Token;

    } catch (error) {
        console.error("Auth0 Token Error:", error);
        return null;
    }
};

// Auth0 API call functions (the "tools")
const Auth0Api = {
    /**
     * Calls the Auth0 Management API to retrieve a list of all users.
     */
    list_users: async () => {
        console.log("Attempting to call Auth0Api.list_users...");
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/users`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        console.log("Auth0 list_users response:", JSON.stringify(data, null, 2));

        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}. Response: ${JSON.stringify(data)}`);
        }
        return data;
    },
    /**
     * Calls the Auth0 Management API to get high-level tenant settings.
     */
    get_tenant_settings: async () => {
        console.log("Attempting to call Auth0Api.get_tenant_settings...");
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/tenants/settings`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        console.log("Auth0 get_tenant_settings response:", JSON.stringify(data, null, 2));
        
        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}. Response: ${JSON.stringify(data)}`);
        }
        return data;
    },
    /**
     * Calls the Auth0 Management API to retrieve a list of signing keys (SAML certificates).
     */
    list_signing_keys: async () => {
        console.log("Attempting to call Auth0Api.list_signing_keys...");
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/keys/signing`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        console.log("Auth0 list_signing_keys response:", JSON.stringify(data, null, 2));

        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}. Response: ${JSON.stringify(data)}`);
        }
        return data;
    }
};

const callGeminiWithTools = async (prompt, tools) => {
    const payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{ "text": prompt }]
            }
        ],
        "tools": [{
            "function_declarations": tools
        }]
    };
    
    console.log("--- Calling Gemini with tools... ---");
    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API call failed with status: ${response.status}. Response: ${errorText}`);
    }

    const data = await response.json();
    console.log("Gemini response (first call):", JSON.stringify(data, null, 2));

    return data.candidates[0].content;
};

const callGeminiForResponse = async (prompt, toolResponse) => {
    const payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{ "text": `Given the following user query: "${prompt}" and the API response: "${JSON.stringify(toolResponse.response)}", please provide a concise and professional summary. Format the information with clear, bold headings and use bullet points for lists to make it easy to read.` }]
            },
            {
                "role": "tool",
                "parts": [{
                    "function_response": {
                        "name": toolResponse.name,
                        "response": toolResponse.response
                    }
                }]
            }
        ]
    };
    
    console.log("--- Calling Gemini for final response... ---");
    console.log("Data sent to Gemini (second call):", JSON.stringify(payload, null, 2));

    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API call failed with status: ${response.status}. Response: ${errorText}`);
    }

    const data = await response.json();
    console.log("Gemini response (second call):", JSON.stringify(data, null, 2));
    
    const finalResponseText = data.candidates[0].content.parts[0].text;
    console.log("Final response text to be sent to front-end:", finalResponseText);

    return finalResponseText;
};

const availableTools = [
    {
        name: "list_users",
        description: "Retrieves a list of all users in the Auth0 tenant. Use for requests like 'how many users' or 'list all users'.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "get_tenant_settings",
        description: "Retrieves the high-level configuration and settings for the Auth0 tenant.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "list_signing_keys",
        description: "Retrieves all application signing keys, which includes SAML certificates. Use for requests about expiring or current certificates.",
        parameters: { type: "object", properties: {} }
    }
];

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
    console.log("--- Starting Serverless Function ---");
    console.log("AUTH0_DOMAIN:", AUTH0_DOMAIN ? "Set" : "Undefined");
    console.log("AUTH0_CLIENT_ID:", AUTH0_CLIENT_ID ? "Set" : "Undefined");
    console.log("AUTH0_CLIENT_SECRET:", AUTH0_CLIENT_SECRET ? "Set" : "Undefined");
    console.log("GEMINI_API_KEY:", GEMINI_API_KEY ? "Set" : "Undefined");
    
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const { prompt } = req.body;
    if (!prompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
    }

    try {
        const geminiResponse = await callGeminiWithTools(prompt, availableTools);
        const parts = geminiResponse.parts || [];
        const functionCall = parts.find(part => part.functionCall);

        console.log("Function call object from Gemini:", functionCall);

        if (functionCall && functionCall.functionCall && functionCall.functionCall.name) {
            const functionName = functionCall.functionCall.name;
            let toolResponseData;
            
            console.log(`Checking for local tool implementation for: ${functionName}`);
            if (Auth0Api[functionName]) {
                toolResponseData = await Auth0Api[functionName]();
            } else {
                throw new Error(`Function ${functionName} not found.`);
            }

            const finalResponse = await callGeminiForResponse(
                prompt,
                { name: functionName, response: { data: toolResponseData } }
            );

            res.json({ response: finalResponse });
        } else {
            res.json({ response: geminiResponse.parts?.[0]?.text || 'I am sorry, I could not fulfill your request.' });
        }
    } catch (error) {
        console.error('Error in chat flow:', error);
        res.status(500).json({ error: 'Apologies, I encountered an internal error. Please check the server logs.' });
    }
};
