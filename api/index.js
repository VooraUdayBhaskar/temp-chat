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

// Function to get a fresh Auth0 Management API token
const getAuth0Token = async () => {
    const now = Date.now();
    if (auth0Token && tokenExpiry > now) {
        return auth0Token;
    }

    const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
    const payload = {
        client_id: AUTH0_CLIENT_ID,
        client_secret: AUTH0_CLIENT_SECRET,
        audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        grant_type: 'client_credentials'
    };

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Auth0 token retrieval failed with status: ${response.status}`);
        }

        const data = await response.json();
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
    listUsers: async () => {
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/users`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}`);
        }
        return await response.json();
    },
    getTenantSettings: async () => {
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/tenants/settings`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}`);
        }
        return await response.json();
    },
    listSigningKeys: async () => {
        const token = await getAuth0Token();
        if (!token) throw new Error('Could not retrieve Auth0 token.');

        const url = `https://${AUTH0_DOMAIN}/api/v2/keys/signing`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error(`Auth0 API call failed with status: ${response.status}`);
        }
        return await response.json();
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
    return data.candidates[0].content;
};

const callGeminiForResponse = async (prompt, toolResponse) => {
    const payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{ "text": prompt }]
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
    return data.candidates[0].content.parts[0].text;
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

// --- Vercel Serverless Function Handler ---
module.exports = async (req, res) => {
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
        const functionCall = geminiResponse.parts.find(part => part.function_call);

        if (functionCall) {
            const functionName = functionCall.function_call.name;
            let toolResponseData;
            
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
            res.json({ response: geminiResponse.parts[0].text });
        }
    } catch (error) {
        console.error('Error in chat flow:', error);
        res.status(500).json({ error: 'Apologies, I encountered an internal error. Please check the server logs.' });
    }
};
