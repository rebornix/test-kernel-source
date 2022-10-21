import * as vscode from 'vscode';
export type JupyterServerUriHandle = string;
const isReachable = require('is-reachable');

export interface IJupyterServerUri {
    baseUrl: string;
    token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationHeader: any; // JSON object for authorization header.
    expiration?: Date; // Date/time when header expires and should be refreshed.
    displayName: string;
}


export interface IJupyterUriProvider {
    /**
     * Should be a unique string (like a guid)
     */
    readonly id: string;
    displayName?: string;
    onDidChangeHandles?: vscode.Event<void>;
    getQuickPickEntryItems?(): vscode.QuickPickItem[];
    handleQuickPick?(item: vscode.QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    /**
     * Given the handle, returns the Jupyter Server information.
     */
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
    /**
     * Gets a list of all valid Jupyter Server handles that can be passed into the `getServerUri` method.
     */
    getHandles?(): Promise<JupyterServerUriHandle[]>;
}

interface ICachedServer extends IJupyterServerUri {
    // serverProcess: any;
}

interface IQuickPick extends vscode.QuickPickItem {
    id: string;
}

class LocalServer implements IJupyterUriProvider {
    id: string = 'RemoteServerPickerExample';
    displayName = 'GitHub';
    private _eventEmitter = new vscode.EventEmitter<void>();
    onDidChangeHandles = this._eventEmitter.event;
    private _token: string | undefined = undefined;
    private _server: IJupyterServerUri | undefined = undefined;

    constructor(readonly context: vscode.ExtensionContext) {
    }

    getQuickPickEntryItems(): IQuickPick[] {
        return [
            {
                id: 'create-cpu',
                label: 'Connect to Jupyter Server (CPU)',
                // detail: 'New jupyter server on Codespace (CPU)',
            }
        ];
    }

    async handleQuickPick(item: IQuickPick, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined> {
        if (item.id === 'create-cpu') {
            return this.createServer();
        }

        return undefined;
    }

    async createServer(): Promise<JupyterServerUriHandle> {
        const baseUrl = 'http://localhost:8888';
        let token = this._token;

        if (!token) {
            token = await vscode.window.showInputBox({
                title: 'Enter token',
                prompt: 'Enter token',
                value: '',
                ignoreFocusOut: true,
            });
        }

        if (!token) {
            throw new Error('Token is required');
        }

        this._token = token;
        this._server = {
            baseUrl,
            token,
            displayName: 'GitHub jupyter server (cpu)',
            authorizationHeader: { Authorization: `token ${token}` },
        };
        
        return this._server.baseUrl;
    }

    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        if (handle !== this._server?.baseUrl) {
            throw new Error('Invalid handle');
        }

        return this._server;
    }

    async getHandles(): Promise<JupyterServerUriHandle[]> {
        const ir = await isReachable('http://localhost:8888' );

        if (ir) {
            return [
                'http://localhost:8888'
            ];
        } else {
            return [];
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const jupyter = vscode.extensions.getExtension('ms-toolsai.jupyter');
    if (jupyter) {
        await jupyter.activate();
    }
    if (jupyter?.exports) {
        const api = jupyter.exports;
        const localServer = new LocalServer(context);
        api.registerRemoteServerProvider(localServer);

        context.subscriptions.push(vscode.commands.registerCommand('kernel-resolver.connectJupyterServer', async (args) => {
            const handle = await localServer.createServer();
            await api.addRemoteJupyterServer('RemoteServerPickerExample', handle);
        }));
    }
}
// this method is called when your extension is deactivated
export function deactivate() {}