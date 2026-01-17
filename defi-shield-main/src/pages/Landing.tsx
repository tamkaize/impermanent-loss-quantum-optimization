import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  Zap, 
  Shield, 
  BarChart3, 
  TrendingUp, 
  ArrowRight,
  Fuel,
  Repeat,
  AlertTriangle,
  DollarSign,
  Target
} from 'lucide-react';

const concepts = [
  {
    icon: Target,
    title: "Pool",
    description: "A place to deposit your crypto and earn rewards. Like a high-yield savings account, but for cryptocurrency."
  },
  {
    icon: Shield,
    title: "Hedge",
    description: "Protection against losses. If prices move against you, a hedge helps limit how much you can lose."
  },
  {
    icon: AlertTriangle,
    title: "Impermanent Loss (IL)",
    description: "When you provide liquidity and prices change, you might end up with less value than if you just held. This loss is 'impermanent' until you withdraw."
  },
  {
    icon: Fuel,
    title: "Gas",
    description: "The fee you pay to use the blockchain. Every transaction costs gas, like a processing fee."
  },
  {
    icon: TrendingUp,
    title: "Slippage",
    description: "The difference between the price you expect and what you actually get. Happens when markets are busy or you're trading large amounts."
  },
  {
    icon: Zap,
    title: "MEV",
    description: "Maximal Extractable Value - when bots see your pending transaction and trade ahead of you to profit. Like someone cutting in line at a store."
  },
];

const Landing = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span className="text-sm text-primary font-medium">Hackathon MVP Demo</span>
            </div>
            
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
              Stop Getting Fooled by{' '}
              <span className="gradient-text">Headline APY</span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              That 200% APY looks amazing... until gas fees, slippage, and impermanent loss eat your profits. 
              Kurtosis Labs shows you the <strong>real</strong> returns after all costs.
            </p>
            
            <Link to="/optimizer">
              <Button size="lg" className="gap-2 text-lg px-8 py-6">
                Open Optimizer
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Problem Statement */}
      <section className="py-16 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-2xl font-bold mb-4">The Problem</h2>
                <p className="text-muted-foreground leading-relaxed">
                  DeFi protocols advertise attractive APYs, but these numbers often ignore:
                </p>
                <ul className="mt-4 space-y-3">
                  {[
                    "Gas costs that eat into profits",
                    "Slippage on every trade",
                    "MEV bots front-running your transactions",
                    "Impermanent loss when prices move",
                    "Protocol failures and smart contract risks"
                  ].map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-6 rounded-xl bg-card border border-border">
                <div className="text-center mb-4">
                  <div className="text-sm text-muted-foreground">Advertised APY</div>
                  <div className="text-4xl font-bold text-success">156.8%</div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gas costs</span>
                    <span className="text-destructive">-24.2%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Slippage</span>
                    <span className="text-destructive">-8.5%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MEV losses</span>
                    <span className="text-destructive">-5.1%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IL penalty</span>
                    <span className="text-destructive">-42.3%</span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border flex justify-between">
                  <span className="font-medium">Actual Net APY</span>
                  <span className="text-xl font-bold text-warning">76.7%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Concepts Grid */}
      <section className="py-16 border-t border-border bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-2 text-center">Key Concepts</h2>
            <p className="text-muted-foreground text-center mb-8">
              New to DeFi? Here's what you need to know:
            </p>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {concepts.map(({ icon: Icon, title, description }) => (
                <div key={title} className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <h3 className="font-semibold">{title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-8 text-center">How Kurtosis Labs Works</h2>
            
            <div className="grid md:grid-cols-4 gap-6">
              {[
                { step: 1, title: "Input Pools", desc: "Add the DeFi pools you're considering" },
                { step: 2, title: "Set Scenario", desc: "Choose calm or chaotic market conditions" },
                { step: 3, title: "Run Optimizer", desc: "Our solver finds the best risk-adjusted strategy" },
                { step: 4, title: "Get Results", desc: "See real net APY after all costs and risks" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="text-center">
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center mx-auto mb-3 font-bold text-primary-foreground">
                    {step}
                  </div>
                  <h3 className="font-semibold mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 border-t border-border">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to See Your Real Returns?</h2>
          <p className="text-muted-foreground mb-8">
            Stop guessing. Start optimizing.
          </p>
          <Link to="/optimizer">
            <Button size="lg" className="gap-2">
              Launch Optimizer
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Kurtosis Labs • Hackathon MVP • No Real Transactions</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
