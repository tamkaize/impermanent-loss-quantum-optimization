import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export const WaitlistForm = () => {
    const [email, setEmail] = useState('');
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email || !email.includes('@')) {
            toast.error("Please enter a valid email address");
            return;
        }

        setIsLoading(true);

        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 800));

        setIsLoading(false);
        setIsSubmitted(true);
        toast.success("Welcome to the future of DeFi!");

        // Reset after a while so they can see the form again if needed, 
        // or keep it ensuring they know they are in.
        // For now, let's keep the success state to make it feel permanent.
    };

    if (isSubmitted) {
        return (
            <div className="w-full max-w-md mx-auto p-6 rounded-2xl bg-primary/10 border border-primary/20 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
                        You're on the list!
                    </h3>
                    <p className="text-muted-foreground text-sm">
                        We'll notify you as soon as higher-order Dirac solvers are available for your account.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-lg mx-auto mt-12 relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 via-purple-500/30 to-blue-500/30 rounded-2xl blur-xl opacity-75 animate-pulse" />
            <div className="relative p-8 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-xl shadow-2xl">
                <div className="flex flex-col gap-2 mb-8">
                    <div className="flex items-center gap-2 text-primary font-semibold tracking-wide uppercase text-xs">
                        <Sparkles className="w-4 h-4" />
                        <span>Exclusive Early Access</span>
                    </div>
                    <h3 className="text-2xl font-bold text-white leading-tight">
                        Maximize Your Yields with <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">Quantum Precision</span>
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        Be the first to optimize your LP positions with our institutional-grade risk engine.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex gap-3">
                        <Input
                            type="email"
                            placeholder="professional@trader.com"
                            className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 transition-all h-12 text-lg text-white placeholder:text-white/20"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                        />
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="group bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white shadow-lg shadow-primary/25 min-w-[140px] h-12 text-lg font-semibold"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    Get Access
                                    <ArrowRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </Button>
                    </div>
                </form>
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span>Free for beta testers</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span>No waitlist spam</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
